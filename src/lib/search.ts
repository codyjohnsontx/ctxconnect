/**
 * Attend's first search. One box, three things the advisor can be holding when
 * a customer calls: the name she was just told, the number on the caller ID, or
 * a phrase she remembers texting.
 *
 * Prisma types are imported for their shape only, so this module stays free of
 * the database client and can be unit tested.
 */

import type { Prisma } from "@/generated/prisma/client";

export function normalizeSearchTerm(raw: string | undefined | null) {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

// Phone numbers are stored in E.164 (+15125550110) and read aloud in every
// other format, so a number search is matched on its digits alone. Under three
// digits is noise rather than a number, and would match most of the dealership.
export function searchPhoneDigits(term: string) {
  const digits = term.replace(/\D/g, "");

  return digits.length >= 3 ? digits : null;
}

// `contains` reaches Postgres as a LIKE/ILIKE pattern with nothing escaped, so
// a typed % or _ would be read as a wildcard: searching "15%" would return the
// entire queue and read as a search that ignored her. Backslash is Postgres's
// default LIKE escape character, so it has to escape itself too.
export function escapeLikeWildcards(term: string) {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function containsTerm(text: string, term: string) {
  const normalized = normalizeSearchTerm(term);

  return normalized.length > 0 && text.toLowerCase().includes(normalized.toLowerCase());
}

// Null when there is nothing to search for, so the caller can leave the queue
// query untouched rather than AND-ing an empty clause onto it.
export function conversationSearchWhere(term: string): Prisma.ConversationWhereInput | null {
  const normalized = normalizeSearchTerm(term);

  if (!normalized) {
    return null;
  }

  const digits = searchPhoneDigits(normalized);
  const literal = escapeLikeWildcards(normalized);

  return {
    OR: [
      { customer: { name: { contains: literal, mode: "insensitive" } } },
      { messages: { some: { body: { contains: literal, mode: "insensitive" } } } },
      ...(digits ? [{ customer: { phone: { contains: digits } } }] : []),
    ],
  };
}

/**
 * The queue's whole where-clause: what this reader may open, what she has
 * filtered to, and what she is searching for - all three ANDed.
 *
 * The search gets its own entry rather than being merged into the filters. The
 * filters already own a top-level `OR` - that is what `needsAction` is - so a
 * search folded in beside it would widen the queue she narrowed, and it would
 * widen it past the scope clause that decides which threads she may read at
 * all. AND-ing is what makes a search structurally incapable of showing her
 * somebody else's department.
 */
export function conversationQueryWhere(
  scope: Prisma.ConversationWhereInput,
  filters: Prisma.ConversationWhereInput,
  term: string | undefined | null,
): Prisma.ConversationWhereInput {
  const search = conversationSearchWhere(normalizeSearchTerm(term));

  return { AND: search ? [scope, filters, search] : [scope, filters] };
}

// A row matched on message text shows the newest matching message rather than
// the newest message, otherwise a hit whose preview has moved on reads as a
// result the search made up.
export function matchSnippet(body: string, term: string, radius = 48) {
  const normalized = normalizeSearchTerm(term);
  const index = normalized ? body.toLowerCase().indexOf(normalized.toLowerCase()) : -1;

  if (index < 0) {
    return body.length > radius * 2 ? `${body.slice(0, radius * 2).trimEnd()}…` : body;
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(body.length, index + normalized.length + radius);

  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
}
