// A customer who texts the dealership for the first time arrives as a phone
// number and nothing else, so Attend files them under a name it made up from
// the last four digits. The advisor is usually told the real name in that very
// first sentence - and until this module existed there was nowhere to put it,
// so the placeholder followed the customer onto the queue, into her follow-ups
// and into the "Hi {{customerName}}" opening of every template Attend sends.
//
// Pure and database-free on purpose: the inbound webhook, the profile card and
// the server action all have to agree on what an un-named customer looks like
// and what a name has to be before it is written.

export const CUSTOMER_NAME_MAX_LENGTH = 120;
export const CUSTOMER_EMAIL_MAX_LENGTH = 254;
export const CUSTOMER_NOTES_MAX_LENGTH = 2000;

export const CUSTOMER_NAME_REQUIRED =
  "Enter the customer's name. Your queue, your follow-ups and every text Attend sends use it.";
export const CUSTOMER_NAME_TOO_LONG = `That name is too long. Keep it to ${CUSTOMER_NAME_MAX_LENGTH} characters or fewer.`;
export const CUSTOMER_EMAIL_INVALID =
  "That email address does not look right. Check it, or leave it blank.";
export const CUSTOMER_NOTES_TOO_LONG = `Those notes are too long. Keep them to ${CUSTOMER_NOTES_MAX_LENGTH} characters or fewer.`;
export const UNNAMED_CUSTOMER_PROMPT =
  "Attend named this customer from their phone number. Add the name they gave you.";

/**
 * The name the inbound webhook gives a number nobody has met yet. Exported so
 * the webhook and the "is this still a placeholder?" check cannot drift apart.
 */
export function placeholderCustomerName(phone: string) {
  return `Unknown ${phone.slice(-4)}`;
}

/**
 * True while the stored name is still the one Attend invented for this phone
 * number, or nothing at all. Deliberately tied to the number: a customer really
 * called "Unknown 1234" on some other line is a person with a name, not a gap.
 */
export function isUnnamedCustomer(name: string | null | undefined, phone: string) {
  const stored = (name ?? "").trim();

  if (!stored) {
    return true;
  }

  return stored.toLowerCase() === placeholderCustomerName(phone).toLowerCase();
}

export type CustomerProfileDraft = {
  name: string;
  email: string;
  notes: string;
};

export type CustomerProfileValues = {
  name: string;
  email: string | null;
  notes: string | null;
};

export type CustomerProfileCheck =
  | { ok: true; values: CustomerProfileValues }
  | { ok: false; message: string };

/** What the save reports back to the card, so a refusal is readable in place. */
export type CustomerProfileSaveResult = { ok: true } | { ok: false; message: string };

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

// Deliberately not a full RFC address grammar - this is a dealership contact
// field, and the only mistakes worth catching are the ones a person makes while
// typing between customers: a missing @, a stray space, half an address.
function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

/**
 * The one place a customer's editable details are checked. Returns the values
 * to write, or the exact sentence the advisor should read - never a code, and
 * never a silent drop, because a blank name would erase the only thing
 * identifying the person she is texting.
 */
export function checkCustomerProfile(draft: CustomerProfileDraft): CustomerProfileCheck {
  const name = collapseWhitespace(draft.name);
  const email = draft.email.trim();
  const notes = draft.notes.trim();

  if (!name) {
    return { ok: false, message: CUSTOMER_NAME_REQUIRED };
  }

  if (name.length > CUSTOMER_NAME_MAX_LENGTH) {
    return { ok: false, message: CUSTOMER_NAME_TOO_LONG };
  }

  if (email && (!looksLikeEmail(email) || email.length > CUSTOMER_EMAIL_MAX_LENGTH)) {
    return { ok: false, message: CUSTOMER_EMAIL_INVALID };
  }

  if (notes.length > CUSTOMER_NOTES_MAX_LENGTH) {
    return { ok: false, message: CUSTOMER_NOTES_TOO_LONG };
  }

  return {
    ok: true,
    values: {
      name,
      email: email || null,
      notes: notes || null,
    },
  };
}

/**
 * What the card puts in its fields, from what the database holds. A name Attend
 * invented starts the field empty rather than filled: it is not an answer worth
 * keeping, and pre-filling it would make her select and delete "Unknown 9911"
 * before she can type the name she was just told.
 */
export function customerProfileDraft(customer: {
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
}): CustomerProfileDraft {
  return {
    name: isUnnamedCustomer(customer.name, customer.phone) ? "" : customer.name,
    email: customer.email ?? "",
    notes: customer.notes ?? "",
  };
}

/**
 * How the customer asked to be reached. The stored values read as shouting or
 * as a typo on a profile card ("Sms"), so they are named the way an advisor
 * would say them out loud.
 */
export function preferredContactLabel(method: string) {
  switch (method) {
    case "SMS":
      return "Text message";
    case "PHONE":
      return "Phone call";
    case "EMAIL":
      return "Email";
    default:
      return method;
  }
}

export function isSameCustomerProfile(a: CustomerProfileDraft, b: CustomerProfileDraft) {
  return a.name === b.name && a.email === b.email && a.notes === b.notes;
}
