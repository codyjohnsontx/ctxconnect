/**
 * The one length fact an advisor can act on: this reply is too long to send.
 *
 * The reply box and the send route have to agree about where that line is and
 * what to say when it is crossed, or she gets refused by one in words the other
 * never used. So the limit and the sentence live here.
 *
 * There is no single limit. Twilio picks the encoding from the body: a reply it
 * can write in GSM-7 holds 1600 characters, and one character outside that
 * alphabet - an emoji, a curly quote pasted from an email, a name with the wrong
 * accent on it - moves the whole reply to UCS-2, where it holds 700. So the line
 * moves as she types, and where it is can only be answered by reading the body.
 *
 * Deliberately not here: how many separate texts a reply arrives as. That is a
 * carrier-billing fact she cannot act on beyond "write less", and the box has
 * one line of attention to spend. `smsSegments` exists because the caps below
 * are segment arithmetic and this is where that arithmetic is kept honest, but
 * nothing on screen shows it. See
 * content/decisions/2026-08-17-refuse-long-replies-without-teaching-sms-segments.md.
 */

/** Which alphabet Twilio will encode a body in. It reads the body to decide. */
export type SmsEncoding = "GSM-7" | "UCS-2";

/**
 * What one text holds, per encoding, in that encoding's own units: septets for
 * GSM-7, UTF-16 code units for UCS-2.
 *
 * Sources: Twilio, "How long can a message be?"
 * (https://www.twilio.com/docs/glossary/what-sms-character-limit) for 160/153,
 * 70/67 and the 1600-character body maximum; Twilio error 21617
 * (https://www.twilio.com/docs/api/errors/21617) for the body being refused
 * outright past it, and for non-GSM-7 characters reaching that limit sooner.
 * The 700-character UCS-2 maximum is the same budget measured in UCS-2:
 * 1600 septets of room is 700 sixteen-bit characters.
 *
 * Twilio states that maximum in characters. This module spends it as a septet
 * budget instead, so a two-septet extension character - a bracket out of a
 * template blank - consumes two of the 1600, and 900 brackets are already past
 * it at 900 characters. The two readings part company only on bodies carrying
 * extension characters, and only in the direction of refusing a reply Twilio
 * might have taken rather than promising one it will refuse, which is the
 * direction this module is required to err in.
 */
export const SMS_LIMITS = {
  "GSM-7": { singleSegment: 160, perConcatenatedSegment: 153, body: 1600 },
  "UCS-2": { singleSegment: 70, perConcatenatedSegment: 67, body: 700 },
} as const;

/**
 * The GSM 7-bit default alphabet, GSM 03.38 / 3GPP TS 23.038, transcribed from
 * the table Twilio publishes at
 * https://www.twilio.com/docs/glossary/what-is-gsm-7-character-encoding and
 * cross-checked against https://en.wikipedia.org/wiki/GSM_03.38.
 *
 * Reading it as "roughly ASCII" is wrong in both directions, which is the whole
 * reason it is written out. Backtick and tab are ASCII and are not in it. So is
 * every ASCII control character except LF and CR. Meanwhile a-grave, e-acute,
 * n-tilde, o-umlaut, the pound sign and a row of Greek capitals are not ASCII
 * and are in it, so a reply about "Café Ñuñez" is still a 1600-character reply.
 *
 * 0x1B is ESC, the escape into the extension table below rather than a
 * character a body can contain, so it is left out: a body carrying a literal
 * U+001B is not something GSM-7 can be trusted to carry, and answering "UCS-2"
 * there under-promises rather than over-promises.
 */
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅå" +
    "Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ" +
    " !\"#¤%&'()*+,-./" +
    "0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNO" +
    "PQRSTUVWXYZÄÖÑÜ§" +
    "¿abcdefghijklmno" +
    "pqrstuvwxyzäöñüà",
);

/**
 * The GSM 03.38 basic character set extension. Each of these is sent as ESC
 * followed by its code, so it costs two septets rather than one - one bracket
 * out of a template blank is two characters of an advisor's 1600.
 */
const GSM7_EXTENDED = new Set("\f^{}\\[~]|€");

/** Septets one character costs in GSM-7, or 0 when GSM-7 cannot carry it. */
function gsm7Cost(character: string): number {
  if (GSM7_BASIC.has(character)) {
    return 1;
  }

  return GSM7_EXTENDED.has(character) ? 2 : 0;
}

type SmsMeasure = {
  encoding: SmsEncoding;
  /** How many characters from the front of it Twilio would take. */
  fits: number;
  /**
   * What it would have cost in septets had every character GSM-7 cannot carry
   * been an ordinary one. Over 1600 here and the reply was too long whatever
   * alphabet it landed in, so the encoding is not what stopped it.
   */
  septetsIfGsm7: number;
};

/**
 * Reads the body once and answers the questions it can only answer together:
 * which alphabet it forces, how much of it would get through, and what it would
 * have measured had nothing in it forced the shorter alphabet.
 *
 * Characters are counted in UTF-16 code units, which is what a JavaScript
 * string length is and also what UCS-2 counts - an emoji outside the basic
 * plane is two of both.
 *
 * `fits` can stop growing and stay stopped, because a reply that has already
 * outgrown its cap cannot grow back under it: adding characters only adds
 * septets, and the one move that lowers the count - falling to UCS-2 - lowers
 * the cap further than it lowers the count.
 */
function measureSms(body: string): SmsMeasure {
  let septets = 0;
  let septetsIfGsm7 = 0;
  let units = 0;
  let forcesUcs2 = false;
  let fits = 0;

  for (const character of body) {
    const cost = gsm7Cost(character);

    if (cost === 0) {
      forcesUcs2 = true;
    } else {
      septets += cost;
    }

    septetsIfGsm7 += cost || 1;
    units += character.length;

    const encoded = forcesUcs2 ? units : septets;

    if (encoded <= SMS_LIMITS[forcesUcs2 ? "UCS-2" : "GSM-7"].body) {
      fits = units;
    }
  }

  return {
    encoding: forcesUcs2 ? "UCS-2" : "GSM-7",
    fits,
    septetsIfGsm7,
  };
}

/**
 * The encoding Twilio would send this reply in. Trimmed first, because the send
 * route trims before it hands the body over, so trailing whitespace must never
 * be what decides.
 */
export function smsEncoding(body: string): SmsEncoding {
  return measureSms(body.trim()).encoding;
}

/**
 * How many separate texts this reply arrives as, or 0 when there is nothing to
 * send. Not shown to the advisor; see the note at the top of this file.
 *
 * Packed rather than divided, because a two-septet escape pair and a two-unit
 * emoji both have to travel whole - neither can be cut down the middle by a
 * segment boundary - so a boundary that would land inside one pushes it into
 * the next segment and leaves a septet unused.
 */
export function smsSegments(body: string): number {
  const trimmed = body.trim();

  if (trimmed === "") {
    return 0;
  }

  const { encoding } = measureSms(trimmed);
  const limits = SMS_LIMITS[encoding];
  const costs = [...trimmed].map((character) =>
    encoding === "UCS-2" ? character.length : gsm7Cost(character),
  );
  const total = costs.reduce((sum, cost) => sum + cost, 0);

  if (total <= limits.singleSegment) {
    return 1;
  }

  let segments = 1;
  let used = 0;

  for (const cost of costs) {
    if (used + cost > limits.perConcatenatedSegment) {
      segments += 1;
      used = 0;
    }

    used += cost;
  }

  return segments;
}

/** What the box and the route both refuse a too-long reply with. */
export type SmsTooLong = {
  /**
   * Characters that have to come off the end before Twilio will take it. Exact
   * for a delete from the end and a guide anywhere else, because a character
   * cut from the middle can be the one holding the shorter limit in place.
   */
  overBy: number;
  message: string;
};

/**
 * Why this reply cannot be sent as a text, or null when it can.
 *
 * One call rather than a length and a sentence fetched separately, so the
 * number under the box and the disabled Send button cannot end up answering
 * from different readings of the same body.
 */
export function smsTooLong(body: string): SmsTooLong | null {
  const trimmed = body.trim();
  const { encoding, fits, septetsIfGsm7 } = measureSms(trimmed);
  const overBy = trimmed.length - fits;

  if (overBy <= 0) {
    return null;
  }

  const cut = overBy === 1 ? "one more character" : `about ${overBy} characters`;

  if (encoding === "UCS-2" && septetsIfGsm7 <= SMS_LIMITS["GSM-7"].body) {
    return {
      overBy,
      message: `That reply is too long to send as a text. An emoji or special character in it shortens what one text holds - take that out, or cut ${cut}.`,
    };
  }

  return {
    overBy,
    message: `That reply is too long to send as a text. Cut ${cut}.`,
  };
}
