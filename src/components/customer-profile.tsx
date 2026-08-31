"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, UserPen } from "lucide-react";
import { updateCustomerProfile } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import {
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_NOTES_MAX_LENGTH,
  UNNAMED_CUSTOMER_PROMPT,
  checkCustomerProfile,
  customerProfileDraft,
  isSameCustomerProfile,
  isUnnamedCustomer,
  preferredContactLabel,
} from "@/lib/customer-identity";
import { formatPhone } from "@/lib/utils";

type CustomerProfileCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  preferredContactMethod: string;
  smsOptedOut: boolean;
};

type CustomerProfileProps = {
  customer: CustomerProfileCustomer;
};

/**
 * The customer's own details, and the only place in Attend they can be
 * corrected. It opens straight into the form while the customer is still
 * carrying the name the inbound webhook made up for them, because that name is
 * about to be texted back to them by every template.
 */
export function CustomerProfile({ customer }: CustomerProfileProps) {
  const saved = customerProfileDraft(customer);
  const unnamed = isUnnamedCustomer(customer.name, customer.phone);

  const [snapshot, setSnapshot] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [isEditing, setIsEditing] = useState(unnamed);
  const [isPending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seeded during render rather than from an effect, so a save - or a
  // colleague's edit landing on the same customer - is in the fields before
  // they are painted rather than a frame after. This is the same trap the
  // conversation controls fell into: an uncontrolled form restores the values
  // it mounted with, so a saved name snaps back and a second press writes the
  // stale one over the real one.
  if (!isSameCustomerProfile(snapshot, saved)) {
    setSnapshot(saved);
    setDraft(saved);
  }

  const isDirty = !isSameCustomerProfile(draft, saved);

  function change(patch: Partial<typeof draft>) {
    setJustSaved(false);
    setError(null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  function save() {
    const checked = checkCustomerProfile(draft);

    if (!checked.ok) {
      setError(checked.message);
      return;
    }

    const payload = new FormData();
    payload.set("customerId", customer.id);
    payload.set("name", draft.name);
    payload.set("email", draft.email);
    payload.set("notes", draft.notes);

    setError(null);
    startTransition(async () => {
      try {
        const result = await updateCustomerProfile(payload);

        if (!result.ok) {
          setError(result.message);
          return;
        }

        setJustSaved(true);
        setIsEditing(false);
      } catch {
        setError("That did not save. Check your connection and try again.");
      }
    });
  }

  if (!isEditing) {
    return (
      <div className="space-y-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <Detail label="Phone" value={formatPhone(customer.phone)} />
        <Detail label="Email" value={customer.email ?? "No email"} />
        <Detail label="Preferred contact" value={preferredContactLabel(customer.preferredContactMethod)} />
        <Detail
          label="SMS consent"
          value={customer.smsOptedOut ? "Opted out via STOP" : "Eligible to receive SMS"}
        />
        <div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Notes</div>
          <div className="whitespace-pre-wrap break-words leading-5 text-zinc-700 dark:text-zinc-300">
            {customer.notes ?? "No notes yet."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            <UserPen className="h-3.5 w-3.5" />
            Edit details
          </Button>
          {justSaved ? (
            <span className="flex items-center gap-1.5 text-xs leading-5 text-green-700 dark:text-green-400">
              <Check className="h-3 w-3 shrink-0" />
              Saved.
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isPending) {
          save();
        }
      }}
    >
      {unnamed ? (
        <p className="rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {UNNAMED_CUSTOMER_PROMPT}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="customer-name">Name</Label>
        <Input
          id="customer-name"
          name="name"
          value={draft.name}
          maxLength={CUSTOMER_NAME_MAX_LENGTH}
          autoComplete="off"
          placeholder="Who is this?"
          onChange={(event) => change({ name: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="customer-email">Email</Label>
        <Input
          id="customer-email"
          name="email"
          type="email"
          value={draft.email}
          autoComplete="off"
          placeholder="Optional"
          onChange={(event) => change({ email: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="customer-notes">Notes</Label>
        <Textarea
          id="customer-notes"
          name="notes"
          value={draft.notes}
          maxLength={CUSTOMER_NOTES_MAX_LENGTH}
          placeholder="What the next person picking up this thread should know."
          onChange={(event) => change({ notes: event.target.value })}
        />
      </div>

      <Detail label="Phone" value={formatPhone(customer.phone)} />
      <Detail label="Preferred contact" value={preferredContactLabel(customer.preferredContactMethod)} />
      <Detail
        label="SMS consent"
        value={customer.smsOptedOut ? "Opted out via STOP" : "Eligible to receive SMS"}
      />

      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" size="sm" disabled={!isDirty || isPending}>
          {isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving
            </>
          ) : (
            "Save details"
          )}
        </Button>
        {/* Not offered while the customer is still un-named: there is nothing
            to go back to, and a cancel that leaves "Unknown 9911" on the thread
            reads as a way to keep it. */}
        {unnamed ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => {
              setDraft(saved);
              setError(null);
              setIsEditing(false);
            }}
          >
            Cancel
          </Button>
        )}
      </div>

      {error ? <p className="text-xs leading-5 text-red-600 dark:text-red-400">{error}</p> : null}
    </form>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="break-words">{value}</div>
    </div>
  );
}
