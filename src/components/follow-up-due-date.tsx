"use client";

import { useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { Input, Label } from "@/components/ui/field";
import { defaultFollowUpDueDate, instantFromDateTimeLocal } from "@/lib/follow-ups";

function subscribe() {
  return () => {};
}

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
 *
 * The draft is held in state, and dropped once the action resolves so the field
 * returns to the default alongside the uncontrolled fields React resets for us.
 */
export function FollowUpDueDate() {
  const { pending } = useFormStatus();
  const [draft, setDraft] = useState<string | null>(null);
  const [wasPending, setWasPending] = useState(false);

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

  return (
    <div className="space-y-1.5">
      <Label htmlFor="follow-up-due-date">Due</Label>
      <Input
        id="follow-up-due-date"
        type="datetime-local"
        required
        value={value}
        onChange={(event) => setDraft(event.target.value)}
      />
      <input type="hidden" name="dueAt" value={instant?.toISOString() ?? ""} />
    </div>
  );
}
