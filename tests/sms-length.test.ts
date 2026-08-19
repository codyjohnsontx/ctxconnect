import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SMS_LIMITS, smsEncoding, smsSegments, smsTooLong } from "../src/lib/sms-length";

const GSM7 = SMS_LIMITS["GSM-7"];
const UCS2 = SMS_LIMITS["UCS-2"];

/** An emoji outside the basic plane, so it is two UTF-16 code units, not one. */
const EMOJI = "\u{1F600}";
/** The apostrophe a paste from email or Word brings with it. */
const CURLY_QUOTE = "’";

describe("smsEncoding", () => {
  // Twilio picks the encoding from the content, so the alphabet has to be the
  // real GSM 03.38 one. "Roughly ASCII" is wrong in both directions and both
  // directions cost the advisor: one says a reply fits when it does not, the
  // other refuses a reply Twilio would have taken.
  it("keeps a reply in GSM-7 when every character is in the alphabet", () => {
    assert.equal(smsEncoding("Your bike is ready."), "GSM-7");
    assert.equal(smsEncoding("Line one\nline two\r"), "GSM-7");
    assert.equal(smsEncoding("Cost is £120, or €95 with the coupon."), "GSM-7");
  });

  it("keeps accented characters that are in GSM-7 in GSM-7", () => {
    assert.equal(smsEncoding("Café for Ñuñez, à la Sørensen"), "GSM-7");
    assert.equal(smsEncoding("èéùìòÇØøÅåÆæßÉÄÖÑÜäöñüà"), "GSM-7");
  });

  it("falls to UCS-2 on an accented character GSM-7 does not carry", () => {
    // a-acute is not in GSM 03.38; a-grave and a-umlaut are. Whether a customer
    // name costs the advisor 900 characters turns on which accent it wears.
    assert.equal(smsEncoding("Tomás"), "UCS-2");
    assert.equal(smsEncoding("Ana Sofía"), "UCS-2");
  });

  it("falls to UCS-2 on ASCII that GSM-7 does not carry", () => {
    assert.equal(smsEncoding("Use the `service` menu"), "UCS-2");
    assert.equal(smsEncoding("Two\tcolumns"), "UCS-2");
  });

  it("falls to UCS-2 on an emoji or a pasted curly quote", () => {
    assert.equal(smsEncoding(`Ready to collect ${EMOJI}`), "UCS-2");
    assert.equal(smsEncoding(`It${CURLY_QUOTE}s ready`), "UCS-2");
  });

  // The route trims before it measures, so a trailing emoji-free newline must
  // not be what decides the encoding either.
  it("ignores surrounding whitespace", () => {
    assert.equal(smsEncoding("  Ready.  \n"), "GSM-7");
  });
});

describe("smsTooLong on a GSM-7 reply", () => {
  it("takes a reply at the limit", () => {
    assert.equal(smsTooLong(""), null);
    assert.equal(smsTooLong("Your bike is ready."), null);
    assert.equal(smsTooLong("A".repeat(GSM7.body)), null);
  });

  // The defect this covers: a 1740-character reply was accepted by the box, Send
  // stayed enabled, and the only refusal came back from the route as "Invalid
  // message payload." - indistinguishable from the software being broken.
  it("reports how far over the limit a long reply is", () => {
    assert.equal(smsTooLong("A".repeat(GSM7.body + 1))?.overBy, 1);
    assert.equal(smsTooLong("A".repeat(1740))?.overBy, 140);
  });

  // The send route trims before it measures, so the box has to trim too or it
  // refuses a reply the route would have accepted.
  it("measures the reply the way the route stores it, trimmed", () => {
    assert.equal(smsTooLong(`  ${"A".repeat(GSM7.body)}  \n`), null);
    assert.equal(smsTooLong(`\n\n${"A".repeat(GSM7.body + 5)}\t\t`)?.overBy, 5);
  });
});

describe("smsTooLong on a reply GSM-7 cannot carry", () => {
  // The defect: one emoji drops the real cap from 1600 to 700, and the box said
  // a 900-character reply fitted. Twilio would have refused it.
  it("refuses a 900-character reply because of one emoji in it", () => {
    const tooLong = smsTooLong(EMOJI + "A".repeat(898));

    assert.equal(tooLong?.overBy, 900 - UCS2.body);
  });

  it("refuses it wherever in the reply the emoji sits", () => {
    // Trailing emoji: the first 899 characters are a GSM-7 reply that fits, so
    // the two code units of the emoji are the whole of what has to come off.
    assert.equal(smsTooLong("A".repeat(899) + EMOJI)?.overBy, 2);
    assert.equal(smsTooLong("A".repeat(450) + EMOJI + "A".repeat(448))?.overBy, 200);
  });

  it("refuses a reply held under 1600 only by a pasted curly quote", () => {
    assert.equal(smsTooLong("A".repeat(400) + CURLY_QUOTE + "A".repeat(399))?.overBy, 800 - UCS2.body);
    // Trailing, the first 799 characters are a GSM-7 reply that fits, so the
    // quote is the whole of what has to come off.
    assert.equal(smsTooLong("A".repeat(799) + CURLY_QUOTE)?.overBy, 1);
  });

  it("refuses a reply carrying an accent GSM-7 does not have", () => {
    assert.equal(smsTooLong("á".repeat(800))?.overBy, 800 - UCS2.body);
  });

  it("takes a UCS-2 reply at its own limit and refuses it one past", () => {
    assert.equal(smsTooLong(EMOJI + "A".repeat(UCS2.body - 2)), null);
    assert.equal(smsTooLong(EMOJI + "A".repeat(UCS2.body - 1))?.overBy, 1);
  });
});

describe("smsTooLong on GSM-7 extension characters", () => {
  // Brackets are how a template leaves a blank, so the two-septet escape is not
  // a hypothetical here: one bracket costs the advisor two of her 1600.
  it("keeps a reply in GSM-7 but charges two septets a character", () => {
    assert.equal(smsEncoding("[see photo]"), "GSM-7");
    assert.equal(smsTooLong("[".repeat(GSM7.body / 2)), null);
    assert.equal(smsTooLong("[".repeat(GSM7.body / 2 + 1))?.overBy, 1);
  });

  it("counts every extension character the standard lists", () => {
    for (const character of ["^", "{", "}", "\\", "[", "]", "~", "|", "€"]) {
      assert.equal(smsEncoding(character), "GSM-7", character);
      assert.equal(smsTooLong(character.repeat(GSM7.body / 2 + 1))?.overBy, 1, character);
    }
  });

  // Form feed is the tenth entry in the extension table. It is also whitespace,
  // so the guard trims it off the ends and only ever charges for it inside.
  it("counts form feed, which the caller trims off the ends", () => {
    assert.equal(smsEncoding("A\fB"), "GSM-7");
    assert.equal(smsTooLong("A" + "\f".repeat(GSM7.body / 2) + "B")?.overBy, 2);
  });

  it("counts what she has to cut, not what a character count would say", () => {
    // 900 braces are 1800 septets. Read as 1600 characters this reply looks
    // fine; the number that actually sends is 100 characters fewer.
    const tooLong = smsTooLong("{".repeat(900));

    assert.equal(tooLong?.overBy, 100);
    assert.match(tooLong?.message ?? "", /Cut about 100 characters\./);
  });
});

describe("smsTooLong message", () => {
  // How much to cut, not what ceiling to land under. The ceiling moves with the
  // body - deleting two characters from the middle of a reply held at 899 by a
  // trailing emoji drops it to 700 - so naming one asserts something the guard
  // cannot know about where she will cut.
  it("names how much to cut", () => {
    assert.match(smsTooLong("A".repeat(1740))?.message ?? "", /Cut about 140 characters\./);
    assert.doesNotMatch(smsTooLong("A".repeat(1740))?.message ?? "", /or fewer/);
  });

  it("reads correctly when it is over by one", () => {
    assert.match(smsTooLong("A".repeat(GSM7.body + 1))?.message ?? "", /Cut one more character\./);
  });

  // Otherwise the advisor reads "cut 200 characters" over a reply she has
  // watched sit happily at 1500 all week, with nothing on screen accounting for
  // it, and the cheaper move - delete one character - stays invisible.
  it("says an emoji or special character is what shortened the reply", () => {
    const tooLong = smsTooLong(EMOJI + "A".repeat(898));

    assert.match(tooLong?.message ?? "", /emoji or special character/i);
    assert.match(tooLong?.message ?? "", /take that out, or cut about 200 characters\./);
  });

  it("does not blame an emoji when there is not one", () => {
    assert.doesNotMatch(smsTooLong("A".repeat(1740))?.message ?? "", /emoji/i);
  });

  // The caveat is only true when the special character is what stopped the
  // send. 1700 plain characters are already 100 over on their own, so blaming
  // the emoji would contradict the count and send her hunting for a glyph that
  // is not the reason.
  it("does not blame a special character for a reply too long without it", () => {
    const tooLong = smsTooLong("A".repeat(1700) + EMOJI);

    assert.equal(tooLong?.overBy, 102);
    assert.doesNotMatch(tooLong?.message ?? "", /emoji|special character/i);
    assert.match(tooLong?.message ?? "", /Cut about 102 characters\./);
  });

  // Both sides of the same reply, one character apart: at 1599 deleting the
  // emoji sends it, so the caveat is the cheapest thing she can be told. At
  // 1601 deleting it changes nothing, so saying it would be a wrong answer.
  it("blames the special character only when taking it out would send the reply", () => {
    assert.match(smsTooLong("A".repeat(GSM7.body - 1) + EMOJI)?.message ?? "", /emoji/i);
    assert.doesNotMatch(smsTooLong("A".repeat(GSM7.body + 1) + EMOJI)?.message ?? "", /emoji/i);
  });

  // The advisor cannot act on how many texts the carrier will bill for, so the
  // refusal must not turn into a lesson about SMS segments.
  it("says nothing about segments, encodings, or texts sent", () => {
    for (const body of ["A".repeat(1740), EMOJI + "A".repeat(898)]) {
      assert.doesNotMatch(smsTooLong(body)?.message ?? "", /segment|GSM|UCS|unicode|separate texts/i);
    }
  });
});

describe("smsSegments", () => {
  it("counts nothing for an empty reply", () => {
    assert.equal(smsSegments(""), 0);
    assert.equal(smsSegments("   \n"), 0);
  });

  it("splits a GSM-7 reply at 160, then every 153", () => {
    assert.equal(smsSegments("A".repeat(GSM7.singleSegment)), 1);
    assert.equal(smsSegments("A".repeat(GSM7.singleSegment + 1)), 2);
    assert.equal(smsSegments("A".repeat(GSM7.perConcatenatedSegment * 2)), 2);
    assert.equal(smsSegments("A".repeat(GSM7.perConcatenatedSegment * 2 + 1)), 3);
  });

  it("splits a UCS-2 reply at 70, then every 67", () => {
    assert.equal(smsSegments(EMOJI + "A".repeat(UCS2.singleSegment - 2)), 1);
    assert.equal(smsSegments(EMOJI + "A".repeat(UCS2.singleSegment - 1)), 2);
    assert.equal(smsSegments(EMOJI + "A".repeat(UCS2.perConcatenatedSegment * 2 - 2)), 2);
    assert.equal(smsSegments(EMOJI + "A".repeat(UCS2.perConcatenatedSegment * 2 - 1)), 3);
  });

  // A two-unit character cannot be cut in half by a segment boundary, so one
  // landing on the seam pushes into the next segment and wastes the septet
  // behind it. Both of these divide to 2 and pack to 3.
  it("does not split a surrogate pair or an escape pair across the seam", () => {
    const straddlingEmoji = "A".repeat(66) + EMOJI + "A".repeat(66);
    const straddlingBrace = "A".repeat(152) + "{" + "A".repeat(152);

    assert.equal(straddlingEmoji.length, UCS2.perConcatenatedSegment * 2);
    assert.equal(smsSegments(straddlingEmoji), 3);
    assert.equal(smsSegments(straddlingBrace), 3);
  });

  it("charges an extension character two septets of its segment", () => {
    assert.equal(smsSegments("[".repeat(GSM7.singleSegment / 2)), 1);
    assert.equal(smsSegments("[".repeat(GSM7.singleSegment / 2 + 1)), 2);
  });
});
