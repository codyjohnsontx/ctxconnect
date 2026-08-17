import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blankFor, fillTemplate, listBlanks, remainingBlanks } from "../src/lib/templates";

const context = {
  customerName: "Kelsey Nakamura",
  advisorName: "Alyssa Torres",
  dealershipName: "CTX MotoWorks",
  unit: "2024 Kawasaki Ninja 400",
};

describe("fillTemplate", () => {
  it("fills the details Attend can read from the thread", () => {
    const filled = fillTemplate(
      "Hi {{customerName}}, this is {{advisorName}} at {{dealershipName}} about your {{unit}}.",
      context,
    );

    assert.equal(
      filled.body,
      "Hi Kelsey Nakamura, this is Alyssa Torres at CTX MotoWorks about your 2024 Kawasaki Ninja 400.",
    );
    assert.deepEqual(filled.blanks, []);
  });

  // The defect this covers: the composer substituted "tomorrow morning" and
  // "6:00 PM", so Attend texted a customer a confirmed appointment nobody had
  // booked. Reproduced against the seeded "Appointment confirmation" template on
  // a thread where the customer had only asked what days were open.
  it("leaves a blank for an appointment date rather than inventing one", () => {
    const filled = fillTemplate(
      "Hi {{customerName}}, your service appointment is confirmed for {{appointmentDate}} with {{advisorName}}.",
      context,
    );

    assert.equal(
      filled.body,
      "Hi Kelsey Nakamura, your service appointment is confirmed for [appointment date] with Alyssa Torres.",
    );
    assert.deepEqual(filled.blanks, ["[appointment date]"]);
    assert.doesNotMatch(filled.body, /tomorrow/i);
  });

  it("leaves a blank for a pickup time rather than inventing one", () => {
    const filled = fillTemplate("Your {{unit}} is ready. We are here until {{pickupTime}}.", context);

    assert.equal(filled.body, "Your 2024 Kawasaki Ninja 400 is ready. We are here until [pickup time].");
    assert.deepEqual(filled.blanks, ["[pickup time]"]);
    assert.doesNotMatch(filled.body, /6:00/);
  });

  // A customer with no vehicle on file used to be texted about "your unit".
  it("asks for the unit when no vehicle is linked", () => {
    const filled = fillTemplate("I saw your interest in the {{unit}}.", { ...context, unit: null });

    assert.equal(filled.body, "I saw your interest in the [unit].");
    assert.deepEqual(filled.blanks, ["[unit]"]);
  });

  it("treats a blank known value as unknown rather than dropping it silently", () => {
    const filled = fillTemplate("Thanks for choosing {{dealershipName}}.", { ...context, dealershipName: "   " });

    assert.equal(filled.body, "Thanks for choosing [dealership name].");
    assert.deepEqual(filled.blanks, ["[dealership name]"]);
  });

  it("lists each blank once, in the order it appears", () => {
    const filled = fillTemplate(
      "{{pickupTime}} works, or {{appointmentDate}}. Confirming {{pickupTime}} either way.",
      context,
    );

    assert.deepEqual(filled.blanks, ["[pickup time]", "[appointment date]"]);
  });

  it("leaves a blank for a placeholder nobody has taught it", () => {
    const filled = fillTemplate("Your {{loanerVehicle}} is reserved.", context);

    assert.deepEqual(filled.blanks, ["[loaner vehicle]"]);
  });

  it("tolerates whitespace inside the braces", () => {
    assert.equal(fillTemplate("Hi {{ customerName }}.", context).body, "Hi Kelsey Nakamura.");
  });
});

describe("blankFor", () => {
  it("reads as words rather than as a variable name", () => {
    assert.equal(blankFor("appointmentDate"), "[appointment date]");
    assert.equal(blankFor("pickup_time"), "[pickup time]");
    assert.equal(blankFor("ro-number"), "[ro number]");
    assert.equal(blankFor("unit"), "[unit]");
  });
});

describe("remainingBlanks", () => {
  it("reports a blank the advisor has not filled in", () => {
    assert.deepEqual(remainingBlanks("Confirmed for [appointment date].", ["[appointment date]"]), [
      "[appointment date]",
    ]);
  });

  it("clears once she has typed over it", () => {
    assert.deepEqual(remainingBlanks("Confirmed for Tuesday at 2pm.", ["[appointment date]"]), []);
  });

  // Matching only the blanks Attend inserted, rather than anything in brackets,
  // keeps her own note to the customer from blocking Send.
  it("ignores brackets the advisor wrote herself", () => {
    assert.deepEqual(remainingBlanks("Bring it in [see photo] and we will look.", []), []);
  });
});

describe("listBlanks", () => {
  it("reads as a sentence for one, two, or three blanks", () => {
    assert.equal(listBlanks([]), "");
    assert.equal(listBlanks(["[a]"]), "[a]");
    assert.equal(listBlanks(["[a]", "[b]"]), "[a] and [b]");
    assert.equal(listBlanks(["[a]", "[b]", "[c]"]), "[a], [b] and [c]");
  });
});
