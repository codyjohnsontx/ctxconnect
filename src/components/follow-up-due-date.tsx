"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { Input, Label } from "@/components/ui/field";
import {
  defaultFollowUpDueDate,
  instantFromDateTimeLocal,
  instantFromZonedIso,
} from "@/lib/follow-ups";

function subscribe() {
  return () => {};
}

const UNREADABLE_DATE = "That is not a date Attend can read. Pick it again.";

/**
 * The due date on the create-follow-up form, read in the advisor's timezone.
 *
 * A `datetime-local` picker produces `2026-09-01T00:30` with no offset, and the
 * server action that stores it runs wherever the server is - UTC on Vercel. So
 * both halves of the date have to happen here, in the only place that knows what
 * clock she is reading:
 *
 * - **The default is computed on the client.** A server pass renders the
 *   placeholder rather than its own idea of her working day, the way
 *   LocalTimestamp does: at 8pm in Texas the server's "today" is already
 *   tomorrow, so it would offer her a date the rule in `defaultFollowUpDueDate`
 *   never meant.
 * - **What is posted is an instant.** The picker itself carries no name; the
 *   hidden `dueAt` beside it carries her pick converted through
 *   `instantFromDateTimeLocal`. `createTask` refuses anything that does not name
 *   its offset, so a submission from a page that has not hydrated - where no
 *   conversion could have happened - fails rather than storing the wrong day.
 * - **A value that will not convert stops the submit here.** This is a field
 *   inside someone else's `<form action={createTask}>`, so it has no submission
 *   of its own to abandon; the picker is marked invalid instead, which is what
 *   the form asks before it posts. A year the browser accepts but the date
 *   reader does not - `20260-09-01T00:30`, or a date whose instant overflows
 *   into year 10000 - otherwise leaves `dueAt` empty or unreadable while the
 *   picker still looks filled in, and she gets createTask's refusal as an error
 *   page rather than as something she can correct.
 *
 * The draft is held in state, and dropped once the action resolves so the field
 * returns to the default alongside the uncontrolled fields React resets for us.
 */
export function FollowUpDueDate() {
  const { pending } = useFormStatus();
  const [draft, setDraft] = useState<string | null>(null);
  const [wasPending, setWasPending] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const seeded = useSyncExternalStore(
    subscribe,
    () => defaultFollowUpDueDate(new Date()),
    () => "",
  );

  if (pending !== wasPending) {
    setWasPending(pending);

    // The follow-up was written: React has just restored every other field to
    // what it was mounted with, and leaving her last pick behind would be the
    // one field that disagrees.
    if (!pending) {
      setDraft(null);
    }
  }

  const value = draft ?? seeded;
  const instant = instantFromDateTimeLocal(value);
  const posted = instant?.toISOString() ?? "";
  // Asked of the string that is actually about to be posted, through the same
  // reader `createTask` will meet it with, so the box refuses exactly what the
  // write refuses. Converting is not enough on its own: 9999-12-31 23:59 picked
  // anywhere west of UTC is a perfectly good Date whose instant lands in year
  // 10000, and an ISO string of `+010000-...` is not one `instantFromZonedIso`
  // accepts. A `max` on the picker cannot stand in for this - a value equal to
  // the max is not an overflow, so the very date above walks through it - and a
  // constant chosen to clear the worst offset would be an assumption about
  // timezones sitting in the code that exists to stop assumptions about
  // timezones.
  const unreadable = value !== "" && !instantFromZonedIso(posted);

  useEffect(() => {
    picker.current?.setCustomValidity(unreadable ? UNREADABLE_DATE : "");
  }, [unreadable]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="follow-up-due-date">Due</Label>
      <Input
        ref={picker}
        id="follow-up-due-date"
        type="datetime-local"
        required
        aria-invalid={unreadable || undefined}
        aria-describedby={unreadable ? "follow-up-due-date-error" : undefined}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
      />
      <input type="hidden" name="dueAt" value={posted} />
      {unreadable ? (
        <p
          id="follow-up-due-date-error"
          className="text-xs leading-5 text-red-600 dark:text-red-400"
        >
          {UNREADABLE_DATE}
        </p>
      ) : null}
    </div>
  );
}
