"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  CONVERSATION_PANEL_ATTRIBUTE,
  isShowingLatest,
  scrollTopShowingEnd,
  scrollsItself,
  shouldFollowNewMessage,
} from "@/lib/thread-scroll";

type ThreadMessagesProps = {
  /** The last message in the rendered thread, or null for an empty one. */
  latestMessageId: string | null;
  /** Whether the signed-in advisor wrote that last message. */
  latestMessageIsHers: boolean;
  className?: string;
  children: ReactNode;
};

/** Where the last message ends, or where the list ends when there are none. */
function endOfThread(box: HTMLElement) {
  return (box.lastElementChild ?? box).getBoundingClientRect().bottom;
}

/** The nearest thing that scrolls, starting with the message list itself. */
function scrollerFor(box: HTMLElement): HTMLElement | null {
  for (let element: HTMLElement | null = box; element; element = element.parentElement) {
    if (scrollsItself(getComputedStyle(element).overflowY)) {
      return element;
    }
  }

  return null;
}

/**
 * The bottom of the part of a scroller the advisor can actually see. The phone
 * layout keeps a band of padding under the page for the bottom bar that floats
 * over it, and content scrolled into that band is behind the bar.
 */
function visibleBottomOf(scroller: HTMLElement) {
  const padding = Number.parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
  return scroller.getBoundingClientRect().bottom - padding;
}

/** Put the newest message on screen, whichever way this layout scrolls. */
function showLatest(box: HTMLElement) {
  const scroller = scrollerFor(box);

  if (!scroller) {
    return;
  }

  if (scroller === box) {
    // Its own window: the end of the box is the end of the conversation.
    box.scrollTop = box.scrollHeight;
    return;
  }

  // Part of the page. The reply box sits directly under the conversation, so
  // bringing the end of that whole panel up to the bottom of the screen lands
  // her on the newest message with the box to answer it already under her
  // thumb - rather than on the end of the page, two panels further down.
  const panel = box.closest<HTMLElement>(`[${CONVERSATION_PANEL_ATTRIBUTE}]`) ?? box;
  scroller.scrollTop = scrollTopShowingEnd(scroller.scrollTop, {
    contentBottom: panel.getBoundingClientRect().bottom,
    viewportBottom: visibleBottomOf(scroller),
  });
}

/**
 * The thread's messages, opened on the newest one.
 *
 * The messages themselves are still rendered on the server and passed straight
 * through as children - this owns nothing but the scroll position, which is the
 * one thing a server render cannot decide.
 */
export function ThreadMessages({
  latestMessageId,
  latestMessageIsHers,
  className,
  children,
}: ThreadMessagesProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const shownMessageId = useRef<string | null>(null);
  const showingLatest = useRef(true);

  // A ref callback runs during the commit, before the browser paints, so the
  // conversation is already at its newest message the first time she sees it.
  // The same line in an effect would paint the top of an eight-hour-old thread
  // and then jump.
  //
  // Its identity has to stay stable across renders: React detaches and
  // re-attaches a ref callback whose identity changed, so an inline one would
  // run this on every re-render and drag her back down mid-scroll every time a
  // control on the thread saved.
  const attach = useCallback((element: HTMLDivElement) => {
    box.current = element;
    showLatest(element);
    showingLatest.current = true;

    // Whichever element scrolled is the one that decides what is on screen, so
    // both candidates are listened to and the event names the answer. That also
    // survives a phone being turned sideways past the wide-screen breakpoint,
    // where the conversation stops scrolling with the page and starts scrolling
    // itself.
    const watchScroll = (event: Event) => {
      const scroller = event.currentTarget as HTMLElement;
      showingLatest.current = isShowingLatest({
        contentBottom: endOfThread(element),
        viewportBottom: visibleBottomOf(scroller),
      });
    };

    const watched = new Set<HTMLElement>([element]);
    const ancestor = element.parentElement ? scrollerFor(element.parentElement) : null;

    if (ancestor) {
      watched.add(ancestor);
    }

    for (const target of watched) {
      target.addEventListener("scroll", watchScroll, { passive: true });
    }

    return () => {
      for (const target of watched) {
        target.removeEventListener("scroll", watchScroll);
      }

      box.current = null;
    };
  }, []);

  useEffect(() => {
    const element = box.current;

    if (!element) {
      return;
    }

    // On the first run after mount this is the message the ref callback has
    // already scrolled to, so the jump below is a no-op that only records it.
    const latestChanged = shownMessageId.current !== latestMessageId;
    shownMessageId.current = latestMessageId;

    if (
      !shouldFollowNewMessage({
        latestChanged,
        wasShowingLatest: showingLatest.current,
        latestIsHers: latestMessageIsHers,
      })
    ) {
      return;
    }

    showLatest(element);
    showingLatest.current = true;
  }, [latestMessageId, latestMessageIsHers]);

  return (
    <div ref={attach} className={className}>
      {children}
    </div>
  );
}
