/**
 * What is narrowing the queue, and the way back out of it.
 *
 * The filter controls sit above the ranked queue, so on a phone a narrowed
 * queue and an empty one look the same: a short list under a block of chrome.
 * Both answers come from the URL rather than from the form, because a filter
 * can arrive on a link as easily as on a press.
 */

import type { InboxFilters } from "@/lib/data";

export type InboxSearchParams = Record<string, string | undefined>;

/**
 * Every query key that narrows the queue, taken from the type the queue query
 * reads them with. Adding a filter to `InboxFilters` without listing it here
 * stops compiling, because a filter the count cannot see is a queue that is
 * shorter than anything on screen explains.
 *
 * `priority` is one of those today: it narrows the query and has no control in
 * the form, so it can only arrive on the URL. It is counted rather than
 * ignored, and clearing filters is the way out of it.
 *
 * `q` narrows the queue too and is deliberately excluded: it is the search box,
 * which sits above these controls with its own label and its own way out.
 * Counting it would report a search as a filter, and clearing the filters would
 * throw away the customer she is looking for.
 */
const narrowingKeys = {
  department: true,
  status: true,
  assigned: true,
  unread: true,
  priority: true,
  tag: true,
  failed: true,
  needsAction: true,
} satisfies Record<Exclude<keyof InboxFilters, "q">, true>;

export const INBOX_FILTER_KEYS = Object.keys(narrowingKeys) as Exclude<keyof InboxFilters, "q">[];

/** How many filters are narrowing the queue right now. */
export function countActiveFilters(searchParams: InboxSearchParams): number {
  return INBOX_FILTER_KEYS.filter((key) => Boolean(searchParams[key])).length;
}

/**
 * Keeps only the listed keys, so leaving one way of narrowing the queue leaves
 * the others - and the thread the advisor is reading - exactly where they were.
 *
 * Everything not listed describes one save rather than one way of narrowing the
 * queue - the hand-off notice, say - and those belong to the navigation that
 * set them.
 */
function inboxHref(searchParams: InboxSearchParams, selectedId: string | undefined, keep: readonly string[]) {
  const params = new URLSearchParams();

  for (const key of keep) {
    const value = searchParams[key];
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();

  return `/inbox${selectedId ? `/${selectedId}` : ""}${query ? `?${query}` : ""}`;
}

/**
 * Drops every filter while keeping the thread she is reading, the origin that
 * drew her back link, and the search those filters were narrowing, so clearing
 * filters widens the queue rather than throwing away where she is.
 */
export function clearFiltersHref(searchParams: InboxSearchParams, selectedId?: string): string {
  return inboxHref(searchParams, selectedId, ["from", "q"]);
}

/**
 * The mirror of it: drops the term and keeps every filter she also set. A
 * search that came up empty is not a reason to throw away the rest.
 */
export function clearSearchHref(searchParams: InboxSearchParams, selectedId?: string): string {
  return inboxHref(searchParams, selectedId, ["from", ...INBOX_FILTER_KEYS]);
}
