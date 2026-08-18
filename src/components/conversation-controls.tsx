"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, Check, Loader2 } from "lucide-react";
import { updateConversation } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/field";
import { ConversationStatus, Department, Priority } from "@/generated/prisma/enums";
import { canAccessConversation } from "@/lib/conversation-access";
import {
  adoptSavedValues,
  type ConversationControlValues,
  handOffReason,
  hasUnsavedControlChanges,
} from "@/lib/conversation-controls-state";
import type { AppUser } from "@/lib/data";
import { labelize } from "@/lib/utils";

const departments = Object.values(Department);
const statuses = Object.values(ConversationStatus);
const priorities = Object.values(Priority);

const UNASSIGNED = "unassigned";

type ConversationControlsProps = {
  conversationId: string;
  users: readonly { id: string; name: string | null }[];
  /** What the database currently holds for this thread. */
  saved: ConversationControlValues;
  currentUser: AppUser;
};

/**
 * The thread's assignee, status, priority and department.
 *
 * These were four uncontrolled selects inside a plain `<form action={...}>`,
 * which React resets once the action resolves. The reset restores the values the
 * selects were mounted with, not the ones that were just saved, so a successful
 * save visibly snapped back - and pressing Save a second time, which is exactly
 * what that looks like it needs, wrote the stale values over the real ones. The
 * draft is held here instead so the panel can only ever show a value the
 * database holds or one the advisor has just picked, and Save is offered only
 * when those two differ.
 */
export function ConversationControls({
  conversationId,
  users,
  saved,
  currentUser,
}: ConversationControlsProps) {
  const [state, setState] = useState({ snapshot: saved, draft: saved });
  const [isPending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the server during render rather than from an effect, so a save
  // - or a change a colleague made to the same thread - lands in the controls
  // without a frame where they disagree with the rest of the page.
  const reconciled = adoptSavedValues(state, saved);

  if (reconciled !== state) {
    setState(reconciled);
  }

  const draft = reconciled.draft;
  const isDirty = hasUnsavedControlChanges(reconciled, saved);

  // The one save that can take the thread away from the person making it: a
  // parts question routed to Parts leaves a service advisor's reach the moment
  // it lands. Worth saying before the click, not after.
  const losesAccess = !canAccessConversation(currentUser, {
    assignedUserId: draft.assignedUserId === UNASSIGNED ? null : draft.assignedUserId,
    department: draft.department,
  });

  function change(patch: Partial<ConversationControlValues>) {
    setSavedAt(false);
    setError(null);
    setState((current) => ({ ...current, draft: { ...current.draft, ...patch } }));
  }

  function save() {
    const payload = new FormData();
    payload.set("conversationId", conversationId);
    payload.set("assignedUserId", draft.assignedUserId);
    payload.set("status", draft.status);
    payload.set("priority", draft.priority);
    payload.set("department", draft.department);

    setError(null);
    startTransition(async () => {
      try {
        await updateConversation(payload);
        setSavedAt(true);
      } catch {
        // A rejected action otherwise leaves the panel looking like the click
        // did nothing, which is the failure this whole component exists to stop.
        setError("That did not save. Check your connection and try again.");
      }
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (isDirty && !isPending) {
          save();
        }
      }}
    >
      {/* Locked while the save is in flight. The payload is built when she
          presses Save, so a value changed after that would be posted as the old
          one and then overwritten by the server's answer when it lands - the
          same silent revert this panel exists to stop, arriving a different way. */}
      <div className="space-y-1.5">
        <Label htmlFor="controls-assignee">Assignee</Label>
        <Select
          id="controls-assignee"
          value={draft.assignedUserId}
          disabled={isPending}
          onChange={(event) => change({ assignedUserId: event.target.value })}
        >
          <option value={UNASSIGNED}>Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="controls-status">Status</Label>
          <Select
            id="controls-status"
            value={draft.status}
            disabled={isPending}
            onChange={(event) => change({ status: event.target.value })}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {labelize(status)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="controls-priority">Priority</Label>
          <Select
            id="controls-priority"
            value={draft.priority}
            disabled={isPending}
            onChange={(event) => change({ priority: event.target.value })}
          >
            {priorities.map((priority) => (
              <option key={priority} value={priority}>
                {labelize(priority)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="controls-department">Department</Label>
        <Select
          id="controls-department"
          value={draft.department}
          disabled={isPending}
          onChange={(event) => change({ department: event.target.value })}
        >
          {departments.map((department) => (
            <option key={department} value={department}>
              {labelize(department)}
            </option>
          ))}
        </Select>
      </div>

      {isDirty && losesAccess ? (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <ArrowRightLeft className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {handOffReason(draft, saved) === "department"
              ? `Saving hands this conversation to ${labelize(draft.department)}.`
              : "Saving takes this conversation off you."}{" "}
            It leaves your inbox and you will not be able to open it again.
          </span>
        </p>
      ) : null}

      <Button type="submit" variant="secondary" className="w-full" disabled={!isDirty || isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving
          </>
        ) : (
          "Save controls"
        )}
      </Button>

      {error ? (
        <p className="text-xs leading-5 text-red-600 dark:text-red-400">{error}</p>
      ) : savedAt && !isDirty ? (
        <p className="flex items-center gap-1.5 text-xs leading-5 text-green-700 dark:text-green-400">
          <Check className="h-3 w-3 shrink-0" />
          Saved.
        </p>
      ) : !isDirty ? (
        <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          Everything here is saved.
        </p>
      ) : null}
    </form>
  );
}
