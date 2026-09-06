import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { isUnnamedCustomer, placeholderCustomerName } from "../src/lib/customer-identity";
import { blankFor, fillTemplate, listBlanks, remainingBlanks } from "../src/lib/templates";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

// The composer cannot answer "who is the advisor?" - the thread page does, and
// hands the answer down. That one expression is the only thing standing between
// an unassigned thread and the blank above, and nothing but a rendered page can
// ask it, so it is read out of the file and run.
//
// The defect this pins, driven end to end against the app before the fix: on the
// seeded unassigned lead, picking "New lead follow-up" filled the box with "Hi
// Theo Hamilton, this is the team at CTX MotoWorks." with Send enabled. "the
// team" is not an internal label - it is wording a dealership customer receives
// by SMS, from a thread nobody had picked up.
describe("the advisor name the thread page hands the composer", () => {
  const source = readFileSync(join(repoRoot, "src", "components", "inbox-view.tsx"), "utf8");
  const derivation = /^\s*const advisorName = (.+);$/m.exec(source)?.[1];

  function advisorNameFor(selectedConversation: unknown) {
    assert.ok(derivation, "inbox-view.tsx no longer derives advisorName in one expression");

    return new Function("selectedConversation", `return ${derivation}`)(selectedConversation);
  }

  it("is nothing at all when the thread is unassigned, so the blank stands", () => {
    const advisorName = advisorNameFor({ assignedUser: null });
    const filled = fillTemplate("Hi {{customerName}}, this is {{advisorName}} at {{dealershipName}}.", {
      ...context,
      advisorName,
    });

    assert.equal(filled.body, "Hi Kelsey Nakamura, this is [advisor name] at CTX MotoWorks.");
    assert.deepEqual(filled.blanks, ["[advisor name]"]);
  });

  it("is the assigned advisor's own name, unchanged", () => {
    const advisorName = advisorNameFor({ assignedUser: { name: "Mason Reed" } });
    const filled = fillTemplate("Hi {{customerName}}, this is {{advisorName}} at {{dealershipName}}.", {
      ...context,
      advisorName,
    });

    assert.equal(filled.body, "Hi Kelsey Nakamura, this is Mason Reed at CTX MotoWorks.");
    assert.deepEqual(filled.blanks, []);
  });

  // The derivation above is only the first route to the composer. The prop is
  // the second, and putting the default back there - `advisorName={advisorName
  // ?? "the team"}` - leaves both tests above green while the customer-facing
  // string comes back. A guard that covers one path and not the other is how
  // the next regression gets in, so every JSX site handing the value on is
  // pinned to the bare name.
  it("reaches the composer bare, with nothing answering for it on the way", () => {
    const passed = [...source.matchAll(/\badvisorName=\{([^}]*)\}/g)].map((match) => match[1].trim());

    assert.ok(passed.length > 0, "inbox-view.tsx no longer passes advisorName to MessageComposer");

    for (const value of passed) {
      assert.equal(value, "advisorName", `inbox-view.tsx hands the composer advisorName={${value}} rather than the derived value`);
    }
  });
});

// The composer holds Send on exactly this predicate, so a test that reaches it
// is testing the protection rather than the plumbing that feeds it.
function sendHeld(filled: { body: string; blanks: string[] }) {
  return remainingBlanks(filled.body, filled.blanks).length > 0;
}

// The customer's name takes the same route as the advisor's above, and had the
// same hole: the page handed the composer whatever name was stored, and for a
// number nobody has met that is the one the inbound webhook invented. Picking
// "New lead follow-up" on such a thread filled the box with "Hi Unknown 4821,
// ..." and left Send enabled - a made-up label, texted to a real person as
// their name. The check that knows a placeholder from a name already existed;
// this derivation is where it is consulted.
describe("the customer name the thread page hands the composer", () => {
  const source = readFileSync(join(repoRoot, "src", "components", "inbox-view.tsx"), "utf8");
  const derivation = /^\s*const customerName =\n?([\s\S]*?);\n/m.exec(source)?.[1];

  function customerNameFor(customer: { name: string; phone: string }) {
    assert.ok(derivation, "inbox-view.tsx no longer derives customerName in one statement");

    return new Function(
      "selectedConversation",
      "isUnnamedCustomer",
      `return ${derivation}`,
    )({ customer }, isUnnamedCustomer);
  }

  const phone = "+15125554821";
  const template = "Hi {{customerName}}, this is {{advisorName}} at {{dealershipName}}.";

  it("is nothing at all while the customer still carries the invented name, so Send is held", () => {
    const customerName = customerNameFor({ name: placeholderCustomerName(phone), phone });
    const filled = fillTemplate(template, { ...context, customerName });

    assert.equal(filled.body, "Hi [customer name], this is Alyssa Torres at CTX MotoWorks.");
    assert.deepEqual(filled.blanks, ["[customer name]"]);
    assert.doesNotMatch(filled.body, /Unknown/);
    assert.equal(sendHeld(filled), true);
  });

  it("is the name the advisor was given, unchanged", () => {
    const customerName = customerNameFor({ name: "Priya Raman", phone });
    const filled = fillTemplate(template, { ...context, customerName });

    assert.equal(filled.body, "Hi Priya Raman, this is Alyssa Torres at CTX MotoWorks.");
    assert.equal(sendHeld(filled), false);
  });

  it("reaches the composer bare, with nothing answering for it on the way", () => {
    const passed = [...source.matchAll(/\bcustomerName=\{([^}]*)\}/g)].map((match) => match[1].trim());

    assert.ok(passed.length > 0, "inbox-view.tsx no longer passes customerName to MessageComposer");

    for (const value of passed) {
      assert.equal(value, "customerName", `inbox-view.tsx hands the composer customerName={${value}} rather than the derived value`);
    }
  });
});

// The dealership's name arrives from the database, and the read used to create
// the row it could not find - named "CTX MotoWorks" - so a dealership that had
// never chosen a name texted customers one anyway. The read now reports an
// absent row as absent; this pins that nothing between the row and the
// composer puts a name back.
describe("the dealership name the thread page hands the composer", () => {
  const data = readFileSync(join(repoRoot, "src", "lib", "data.ts"), "utf8");
  const view = readFileSync(join(repoRoot, "src", "components", "inbox-view.tsx"), "utf8");

  it("is nothing at all for a dealership nobody has configured, so Send is held", () => {
    const filled = fillTemplate("Thanks for choosing {{dealershipName}}, {{customerName}}.", {
      ...context,
      dealershipName: null,
    });

    assert.equal(filled.body, "Thanks for choosing [dealership name], Kelsey Nakamura.");
    assert.deepEqual(filled.blanks, ["[dealership name]"]);
    assert.equal(sendHeld(filled), true);
  });

  it("is read from the settings row, never created alongside it", () => {
    assert.doesNotMatch(data, /dealershipSettings\.upsert/, "data.ts creates a dealership settings row again");
    assert.doesNotMatch(data, /dealershipName: ["'`]/, "data.ts names the dealership itself again");
    assert.match(data, /dealershipName: null/, "data.ts no longer reports an unconfigured dealership as unnamed");
  });

  it("reaches the composer bare, with nothing answering for it on the way", () => {
    const passed = [...view.matchAll(/\bdealershipName=\{([^}]*)\}/g)].map((match) => match[1].trim());

    assert.ok(passed.length > 0, "inbox-view.tsx no longer passes dealershipName to MessageComposer");

    for (const value of passed) {
      assert.equal(
        value,
        "dealershipSettings.dealershipName",
        `inbox-view.tsx hands the composer dealershipName={${value}} rather than the stored value`,
      );
    }
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
