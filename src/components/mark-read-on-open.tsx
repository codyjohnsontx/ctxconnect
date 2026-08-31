"use client";

import { useEffect, useRef } from "react";
import { markConversationRead } from "@/app/actions";
import { reportConversationOpen } from "@/lib/read-on-open";

type MarkReadOnOpenProps = {
  conversationId: string;
  unread: boolean;
};

/**
 * Reports that the advisor has the thread on screen, so the unread marker
 * clears the way it does in every other inbox she uses.
 *
 * This has to run in the browser rather than during the page's render: the
 * queue rows are prefetched links, and hovering one is not reading it. Firing
 * from an effect means only a conversation actually painted for her counts.
 *
 * Renders nothing.
 */
export function MarkReadOnOpen({ conversationId, unread }: MarkReadOnOpenProps) {
  const reported = useRef<string | null>(null);

  useEffect(() => {
    // Once per thread she opens, not once per re-render: marking it read makes
    // `unread` false, which runs this again, and pressing Mark unread makes it
    // true again - neither is her opening the thread a second time. Arriving
    // claims the ref either way, so the press cannot be undone on a thread that
    // was already read - see the module.
    const opening = reportConversationOpen(reported.current, conversationId, unread);

    reported.current = opening.reported;

    if (!opening.markRead) {
      return;
    }

    // A marker that fails to clear leaves her in the state she is already in,
    // so it must not become an error over the conversation she is reading.
    void markConversationRead(conversationId).catch(() => {});
  }, [conversationId, unread]);

  return null;
}
