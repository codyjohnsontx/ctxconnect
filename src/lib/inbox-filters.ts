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
} satisfies Record<keyof InboxFilters, true>;

export const INBOX_FILTER_KEYS = Object.keys(narrowingKeys) as (keyof InboxFilters)[];

/** How many filters are narrowing the queue right now. */
export function countActiveFilters(searchParams: InboxSearchParams): number {
  return INBOX_FILTER_KEYS.filter((key) => Boolean(searchParams[key])).length;
}

/**
 * Drops every narrowing key while keeping the thread she is reading and the
 * origin that drew her back link, so clearing filters widens the queue rather
 * than throwing away where she is.
 *
 * Everything else on the URL describes one save rather than one filter - the
 * hand-off notice, say - and those belong to the navigation that set them.
 */
export function clearFiltersHref(searchParams: InboxSearchParams, selectedId?: string): string {
  const query = searchParams.from ? `?from=${encodeURIComponent(searchParams.from)}` : "";

  return `/inbox${selectedId ? `/${selectedId}` : ""}${query}`;
}
