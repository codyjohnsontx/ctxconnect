/**
 * Where a conversation opens, and when it moves on its own.
 *
 * The thread is rendered oldest message first, so without a rule it starts at
 * the top and the newest message - the one the queue row previewed, and the one
 * the advisor came here to answer - is below the fold. These are plain
 * functions so the rule can be tested without a browser; the box that applies
 * them lives in `components/thread-messages.tsx`.
 *
 * The rule is written against where things end on screen rather than against
 * one box's scroll numbers, because the conversation is not always its own
 * window: on a wide screen it scrolls inside the thread column, and on a phone
 * it scrolls with the page like the rest of the conversation. Both answer the
 * same question - is the end of the conversation on screen - so both share one
 * measurement.
 */

/**
 * Marks the panel the phone layout scrolls to: the header, the conversation and
 * the reply box, in that order. It lives here rather than beside the scroll box
 * that reads it because the thread markup is server-rendered, and a server
 * component cannot import a plain value out of a client module.
 */
export const CONVERSATION_PANEL_ATTRIBUTE = "data-conversation-panel";

/**
 * How close to the end still counts as having the newest message on screen.
 * Roughly one bubble's padding: enough that fractional zoom rounding or a
 * partially clipped timestamp never reads as "she has scrolled back through
 * history", and small enough that a whole hidden message never does either.
 */
export const AT_LATEST_TOLERANCE_PX = 48;

/**
 * Whether an element with this computed `overflow-y` is its own scroll box.
 *
 * `overlay` is a legacy alias some engines still report for `auto`; anything
 * else (`visible`, `hidden`, `clip`) means whatever the element cannot show is
 * reached by scrolling something further up the page instead.
 */
export function scrollsItself(overflowY: string): boolean {
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}

export type EndMetrics = {
  /** Where the content being followed ends, in viewport coordinates. */
  contentBottom: number;
  /** Where the visible part of the scrolling area ends, in the same units. */
  viewportBottom: number;
};

/**
 * Whether the newest message is on screen.
 *
 * Content that ends above the fold is always showing it, which covers both a
 * thread too short to scroll and an over-scroll bounce past the end on iOS.
 */
export function isShowingLatest(
  { contentBottom, viewportBottom }: EndMetrics,
  tolerance: number = AT_LATEST_TOLERANCE_PX,
): boolean {
  return contentBottom - viewportBottom <= tolerance;
}

/**
 * The scroll position that brings the end of the content to the bottom of the
 * visible area, clamped at the top because a conversation shorter than the
 * screen has nothing to scroll.
 */
export function scrollTopShowingEnd(
  scrollTop: number,
  { contentBottom, viewportBottom }: EndMetrics,
): number {
  return Math.max(0, scrollTop + contentBottom - viewportBottom);
}

export type NewMessageDecision = {
  /** The thread gained a message: hers, a colleague's, or the customer's. */
  latestChanged: boolean;
  /** Whether the newest message was on screen just before it arrived. */
  wasShowingLatest: boolean;
  /** Whether the new message is one she just wrote herself. */
  latestIsHers: boolean;
};

/**
 * Whether an arriving message should pull the box down to it.
 *
 * A message she just wrote always does, because pressing send and seeing
 * nothing move is how she comes to doubt it sent. Anyone else's does so only
 * while she is already at the end of the thread: scrolling back through history
 * is how she finds what was promised last week, and yanking the box out from
 * under her to show a message she can reach any time costs her the line she was
 * reading.
 */
export function shouldFollowNewMessage({
  latestChanged,
  wasShowingLatest,
  latestIsHers,
}: NewMessageDecision): boolean {
  return latestChanged && (wasShowingLatest || latestIsHers);
}
