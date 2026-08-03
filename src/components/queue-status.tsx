"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { runAiBriefPass } from "@/app/actions";
import { Button } from "@/components/ui/button";

export type QueueStatusData = {
  briefed: number;
  /**
   * Conversations the pass will consider, so "briefed" has something to be out
   * of. It does not track the rows on screen in either direction: smaller when
   * some of those rows are closed or have no inbound message, which the pass
   * never briefs, and larger under an active filter, because coverage is scoped
   * like the pass itself rather than like the filtered list. See getInboxData.
   */
  queueSize: number;
  lastBriefAt: Date | null;
  aiConfigured: boolean;
};

/**
 * Reports what the ambient AI pass has done to this queue, and lets a person run
 * it now. The result line is deliberately plain: a pass that briefed nothing, or
 * failed, says so rather than looking like it worked.
 */
export function QueueStatus({ status }: { status: QueueStatusData }) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runPass() {
    setMessage(null);
    startTransition(async () => {
      try {
        setMessage(await runAiBriefPass());
      } catch {
        // A rejected action leaves no result line at all, so the button looks
        // like it did nothing. Session expiry, a dropped connection and a server
        // error all land here and all deserve to be visible. What it must not
        // claim is that nothing ran: the pass commits each brief as it goes, so
        // work may already be saved that this reply never made it back to report.
        setMessage("The pass did not report back, so some briefs may already be saved. Reload to see where it got to.");
      }
    });
  }

  if (!status.aiConfigured) {
    return (
      <p className="mb-3 rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
        AI is not configured, so nothing new can be briefed. Add OPENAI_API_KEY to let the ops
        brief pass rank this queue.
      </p>
    );
  }

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2">
        {/* Says only what the insight rows know. Nothing records when a pass ran,
            so this line never claims a last run it cannot observe. The relative
            time is rendered on the server and again on hydration, which can land
            either side of a minute boundary, so the difference is expected. */}
        <p
          suppressHydrationWarning
          className="text-xs leading-5 text-zinc-500 dark:text-zinc-400"
        >
          {status.briefed} of {status.queueSize} briefed
          {status.lastBriefAt
            ? `, newest brief ${formatDistanceToNow(status.lastBriefAt, { addSuffix: true })}`
            : ""}
        </p>
        <Button onClick={runPass} disabled={isPending} variant="ghost" size="sm" className="shrink-0">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {isPending ? "Running" : "Run pass"}
        </Button>
      </div>
      {message ? (
        <p className="mt-1 rounded-md bg-blue-50 p-2 text-xs leading-5 text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          {message}
        </p>
      ) : null}
    </div>
  );
}
