import type { ConsentKeyword } from "../src/lib/consent";

// How each text reads, shared by tests/consent-keywords.test.ts (the rule in
// code) and tests/consent-cache.test.ts (the same rule restated in SQL for the
// backfill), so the two are held to one list.
export const consentReplyCases: Array<[string, ConsentKeyword]> = [
  ["STOP", "REVOKE"],
  ["stop", "REVOKE"],
  [" Stop. ", "REVOKE"],
  ["STOP!!", "REVOKE"],
  ["OPT OUT", "REVOKE"],
  ["opt-out", "REVOKE"],
  ["Opt  out", "REVOKE"],
  ["optout", "REVOKE"],
  ["REVOKE", "REVOKE"],
  ["unsubscribe", "REVOKE"],
  ["StopAll", "REVOKE"],
  ["cancel", "REVOKE"],
  ["End", "REVOKE"],
  ["quit.", "REVOKE"],
  ["unstop", "GRANT"],
  ["start", "GRANT"],
  ["START.", "GRANT"],
  // Whitespace JavaScript trims that is not ASCII: a no-break space, a byte-order mark.
  ["STOP\u00a0", "REVOKE"],
  ["opt\u00a0out", "REVOKE"],
  ["\ufeffstart", "GRANT"],
  ["please\u2028stop", "REVIEW"],
  ["yes", "YES"],
  ["Yes!", "YES"],
  // Possible stop requests in other words: a person decides.
  ["stop please", "REVIEW"],
  ["STOP PLEASE", "REVIEW"],
  ["Please stop texting me", "REVIEW"],
  ["please don't stop working on the carb", "REVIEW"],
  ["don’t text this number", "REVIEW"],
  ["Do not text me again", "REVIEW"],
  ["dont text", "REVIEW"],
  ["remove me from your list", "REVIEW"],
  ["Wrong number", "REVIEW"],
  ["I want to opt out of these", "REVIEW"],
  ["unsubscribe me", "REVIEW"],
  // Ordinary business, which must not block a thread.
  ["yesterday", "NONE"],
  ["I stopped by yesterday", "NONE"],
  ["the nonstop rattle is back", "NONE"],
  ["can I cancel my appointment?", "NONE"],
  ["pick it up at the end of the day", "NONE"],
  ["yes please", "NONE"],
  ["start the work whenever you're ready", "NONE"],
  ["", "NONE"],
];
