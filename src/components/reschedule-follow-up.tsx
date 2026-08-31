"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { rescheduleTask } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import {
  followUpSnoozeOptions,
  instantFromDateTimeLocal,
  toDateTimeLocalValue,
} from "@/lib/follow-ups";

type RescheduleFollowUpProps = {
  taskId: string;
  /** The instant the follow-up currently carries, as a zoned ISO string. */
  dueAt: string;
};

/**
 * Moves one follow-up to a new date, from wherever that follow-up is on screen.
 *
 * Held in client state rather than posted as a plain `<form action={...}>`,
 * because React restores the values a form was mounted with once the action
 * resolves - so a field seeded from the row it edits shows the old date
 * straight after saving the new one, which is the same trap the conversation
 * controls fell into.
 *
 * It is also the only place that knows what timezone the advisor is standing
 * in. The due date arrives as an instant and is read into the picker here; what
 * she picks is turned back into an instant here before it is posted. A server
 * action handed a bare "2026-08-31T17:00" would read it wherever the server is,
 * and on Vercel that is UTC.
 */
export function RescheduleFollowUp({ taskId, dueAt }: RescheduleFollowUpProps) {
  const saved = toDateTimeLocalValue(new Date(dueAt));

  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the server during render, so the field always starts on the
  // date the follow-up actually carries - including one moved by whoever else
  // has this thread open. The first hydration pass counts as one of those: the
  // server read the instant in its own timezone and the browser reads it in
  // hers.
  if (snapshot !== saved) {
    setSnapshot(saved);
    setDraft(saved);
    setError(null);
  }

  function save(value: string) {
    const instant = instantFromDateTimeLocal(value);

    if (!instant) {
      setError("Pick a date first.");
      return;
    }

    const payload = new FormData();
    payload.set("taskId", taskId);
    payload.set("dueAt", instant.toISOString());

    setError(null);
    startTransition(async () => {
      try {
        await rescheduleTask(payload);
        // Closing is the confirmation: the card behind this now reads the new
        // date, and leaving the panel open invites a second identical save.
        setOpen(false);
      } catch {
        setError("That did not save. Check your connection and try again.");
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <CalendarClock className="h-3.5 w-3.5" />
        Reschedule
      </Button>
    );
  }

  return (
    <form
      className="w-full space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isPending) {
          save(draft);
        }
      }}
    >
      <div className="flex flex-wrap gap-2">
        {/* Read at click time rather than in render: the two answers she gives
            most often should cost one press, and they mean her tomorrow. */}
        {followUpSnoozeOptions(new Date()).map((option) => (
          <Button
            key={option.label}
            type="button"
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={() => save(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`reschedule-${taskId}`}>Or pick a date</Label>
        <Input
          id={`reschedule-${taskId}`}
          type="datetime-local"
          value={draft}
          onChange={(event) => {
            setError(null);
            setDraft(event.target.value);
          }}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={isPending || draft === saved}>
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Moving
            </>
          ) : (
            "Move follow-up"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setDraft(saved);
            setError(null);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
      {error ? <p className="text-xs leading-5 text-red-600 dark:text-red-400">{error}</p> : null}
    </form>
  );
}
