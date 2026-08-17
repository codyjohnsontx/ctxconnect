/**
 * Where an unsent reply lives while the advisor is somewhere else.
 *
 * The inbox is two panes: a queue on the left, one thread on the right.
 * Clicking a queue row is how she checks anything - and it replaced whatever
 * she had half-typed with an empty box, as did a reload. This module is the
 * rule for keeping that text, kept free of React and of the database so it can
 * be tested directly.
 */

export type Draft = {
  body: string;
  /**
   * The blanks a template left in this draft ("[appointment date]"). Kept with
   * the body rather than derived on the way back in, because they are what
   * stops Attend texting a customer a detail it never knew - a restored draft
   * that lost them would send. Empty until the template step produces blanks.
   */
  blanks: string[];
};

type StoredDraft = Draft & { savedAt: number };

const KEY_PREFIX = "attend:draft:v1";

/**
 * A draft older than this is not put back, and is cleared when it is found.
 *
 * A shift, not a week. The words are unsent customer-facing text that in
 * practice names the customer and their unit, and a dealership front desk is
 * one browser several people sign into across a day. Long enough to survive
 * lunch, a phone call, or a browser restart; short enough that it is not still
 * there for whoever opens the till tomorrow.
 */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Scoped to the signed-in advisor as well as the conversation: a dealership
 * front desk is one shared browser, and the next person to sign in must not
 * find someone else's words in the box under their own name.
 */
export function draftStorageKey(userId: string, conversationId: string): string {
  return `${KEY_PREFIX}:${userId}:${conversationId}`;
}

/** Whether a stored key belongs to this signed-in advisor - the set sign-out clears. */
export function isDraftKeyFor(key: string, userId: string): boolean {
  return key.startsWith(`${KEY_PREFIX}:${userId}:`);
}

/**
 * What to write for the current box contents, or null when there is nothing
 * worth keeping - the caller removes the entry instead of storing an empty
 * draft that would later read as "you left something here".
 */
export function serializeDraft(draft: Draft, now: number): string | null {
  if (!draft.body.trim()) {
    return null;
  }

  const stored: StoredDraft = {
    body: draft.body,
    blanks: draft.blanks.filter((blank) => typeof blank === "string" && blank.length > 0),
    savedAt: now,
  };

  return JSON.stringify(stored);
}

/**
 * The draft to put back in the box, or null when there is none, it cannot be
 * read, or it has gone stale. Anything unrecognisable is treated as no draft
 * rather than as an error: a corrupt entry must never stop her from typing.
 */
export function parseDraft(raw: string | null | undefined, now: number): Draft | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const { body, blanks, savedAt } = parsed as Partial<StoredDraft>;

  if (typeof body !== "string" || !body.trim()) {
    return null;
  }

  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) {
    return null;
  }

  if (now - savedAt > DRAFT_MAX_AGE_MS) {
    return null;
  }

  return {
    body,
    blanks: Array.isArray(blanks) ? blanks.filter((blank): blank is string => typeof blank === "string") : [],
  };
}
