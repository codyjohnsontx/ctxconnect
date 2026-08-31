import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultTemplateData } from "../prisma/baseline-data";
import {
  CUSTOMER_EMAIL_INVALID,
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_NAME_REQUIRED,
  CUSTOMER_NAME_TOO_LONG,
  CUSTOMER_NOTES_MAX_LENGTH,
  CUSTOMER_NOTES_TOO_LONG,
  UNNAMED_CUSTOMER_PROMPT,
  checkCustomerProfile,
  customerProfileDraft,
  isSameCustomerProfile,
  isUnnamedCustomer,
  placeholderCustomerName,
  preferredContactLabel,
} from "../src/lib/customer-identity";

function draft(overrides: Partial<{ name: string; email: string; notes: string }> = {}) {
  return { name: "Marcus Hale", email: "", notes: "", ...overrides };
}

describe("placeholderCustomerName", () => {
  it("names an unknown number by its last four digits", () => {
    assert.equal(placeholderCustomerName("+15125559911"), "Unknown 9911");
  });

  it("does not invent digits for a short number", () => {
    assert.equal(placeholderCustomerName("911"), "Unknown 911");
  });
});

describe("isUnnamedCustomer", () => {
  it("recognises the name the inbound text gave this number", () => {
    const phone = "+15125559911";

    assert.equal(isUnnamedCustomer(placeholderCustomerName(phone), phone), true);
  });

  it("treats a blank or missing name as unnamed", () => {
    assert.equal(isUnnamedCustomer("", "+15125559911"), true);
    assert.equal(isUnnamedCustomer("   ", "+15125559911"), true);
    assert.equal(isUnnamedCustomer(null, "+15125559911"), true);
  });

  it("leaves a real name alone", () => {
    assert.equal(isUnnamedCustomer("Marcus Hale", "+15125559911"), false);
    assert.equal(isUnnamedCustomer("Renee Whitlock", "+15125550110"), false);
  });

  it("does not read another number's placeholder as this customer's gap", () => {
    // A person really recorded as "Unknown 1234" on some other line still has a
    // name as far as this thread is concerned; prompting to replace it would be
    // Attend second-guessing a human decision.
    assert.equal(isUnnamedCustomer("Unknown 1234", "+15125559911"), false);
  });

  it("is not fooled by casing or padding on the stored name", () => {
    assert.equal(isUnnamedCustomer(" unknown 9911 ", "+15125559911"), true);
  });
});

describe("checkCustomerProfile", () => {
  it("accepts a name on its own and stores blank optional fields as nothing", () => {
    const result = checkCustomerProfile(draft());

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.values, {
      name: "Marcus Hale",
      email: null,
      notes: null,
    });
  });

  it("tidies the name rather than storing what the keyboard produced", () => {
    const result = checkCustomerProfile(draft({ name: "  Marcus   Hale \n" }));

    assert.equal(result.ok && result.values.name, "Marcus Hale");
  });

  it("refuses to erase the only thing identifying the person she is texting", () => {
    for (const name of ["", "   ", "\t\n"]) {
      const result = checkCustomerProfile(draft({ name }));

      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.message, CUSTOMER_NAME_REQUIRED);
    }
  });

  it("holds the name to a length a queue row can carry", () => {
    const atLimit = "a".repeat(CUSTOMER_NAME_MAX_LENGTH);
    const overLimit = "a".repeat(CUSTOMER_NAME_MAX_LENGTH + 1);

    assert.equal(checkCustomerProfile(draft({ name: atLimit })).ok, true);

    const result = checkCustomerProfile(draft({ name: overLimit }));

    assert.equal(!result.ok && result.message, CUSTOMER_NAME_TOO_LONG);
  });

  it("keeps an email that could be typed and refuses half of one", () => {
    for (const email of ["marcus@example.com", "marcus.hale+service@shop.co.uk"]) {
      assert.equal(checkCustomerProfile(draft({ email })).ok, true, email);
    }

    for (const email of ["marcus", "marcus@", "@example.com", "marcus @example.com", "marcus@example"]) {
      const result = checkCustomerProfile(draft({ email }));

      assert.equal(result.ok, false, email);
      assert.equal(!result.ok && result.message, CUSTOMER_EMAIL_INVALID);
    }
  });

  it("trims an email rather than storing a trailing space nobody can see", () => {
    const result = checkCustomerProfile(draft({ email: "  marcus@example.com " }));

    assert.equal(result.ok && result.values.email, "marcus@example.com");
  });

  it("holds notes to a length the profile card can show", () => {
    const overLimit = "n".repeat(CUSTOMER_NOTES_MAX_LENGTH + 1);
    const result = checkCustomerProfile(draft({ notes: overLimit }));

    assert.equal(!result.ok && result.message, CUSTOMER_NOTES_TOO_LONG);
    assert.equal(checkCustomerProfile(draft({ notes: "n".repeat(CUSTOMER_NOTES_MAX_LENGTH) })).ok, true);
  });

  it("keeps the line breaks in notes, which are how she separates two calls", () => {
    const notes = "Called Tuesday, wants a Saturday drop-off.\nPrefers texts after 4pm.";
    const result = checkCustomerProfile(draft({ notes }));

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.values.notes, notes);
  });
});

describe("customerProfileDraft", () => {
  it("turns the stored row into fields, with nothing standing in for empty", () => {
    assert.deepEqual(
      customerProfileDraft({ name: "Marcus Hale", phone: "+15125559911", email: null, notes: null }),
      { name: "Marcus Hale", email: "", notes: "" },
    );
  });

  it("leaves the name box empty rather than making her delete Attend's guess", () => {
    assert.deepEqual(
      customerProfileDraft({ name: "Unknown 9911", phone: "+15125559911", email: null, notes: null }),
      { name: "", email: "", notes: "" },
    );
  });

  it("round-trips a saved profile back to the same values", () => {
    const saved = checkCustomerProfile(draft({ email: "marcus@example.com", notes: "Wants Saturday." }));

    assert.equal(saved.ok, true);
    assert.equal(
      saved.ok &&
        isSameCustomerProfile(
          customerProfileDraft({ ...saved.values, phone: "+15125559911" }),
          draft({ email: "marcus@example.com", notes: "Wants Saturday." }),
        ),
      true,
    );
  });
});

describe("preferredContactLabel", () => {
  it("says how the customer asked to be reached, not how it is stored", () => {
    assert.equal(preferredContactLabel("SMS"), "Text message");
    assert.equal(preferredContactLabel("PHONE"), "Phone call");
    assert.equal(preferredContactLabel("EMAIL"), "Email");
  });

  it("shows an unrecognised value rather than an empty line", () => {
    assert.equal(preferredContactLabel("WHATSAPP"), "WHATSAPP");
  });
});

describe("what an unnamed customer costs", () => {
  it("is the opening of the texts Attend sends, which is why the prompt exists", () => {
    // Every shipped opener leads with the customer's name, so an un-named
    // customer is not an internal untidiness - it is "Hi Unknown 9911" arriving
    // on a real person's phone.
    const openers = defaultTemplateData.filter((template) => template.body.includes("{{customerName}}"));

    assert.ok(openers.length > 0);
    assert.ok(UNNAMED_CUSTOMER_PROMPT.length > 0);

    for (const template of openers) {
      assert.ok(
        template.body.indexOf("{{customerName}}") < 30,
        `${template.name} greets the customer by name, so the placeholder is customer-facing`,
      );
    }
  });

  it("says what to do without naming a field, a table or a setting", () => {
    for (const sentence of [
      UNNAMED_CUSTOMER_PROMPT,
      CUSTOMER_NAME_REQUIRED,
      CUSTOMER_EMAIL_INVALID,
      CUSTOMER_NOTES_TOO_LONG,
    ]) {
      for (const jargon of ["null", "database", "field", "Customer.", "record", "API", "_ID"]) {
        assert.ok(!sentence.includes(jargon), `${sentence} should not say ${jargon}`);
      }
    }
  });
});
