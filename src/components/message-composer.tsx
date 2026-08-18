"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { SendHorizonal } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/field";
import { type Draft, draftStorageKey, parseDraft, serializeDraft } from "@/lib/drafts";
import { smsOverBy, smsTooLongMessage } from "@/lib/sms-length";
import { fillTemplate, listBlanks, remainingBlanks } from "@/lib/templates";
import type { Department } from "@/generated/prisma/client";

type Template = {
  id: string;
  name: string;
  department: Department;
  body: string;
};

type MessageComposerProps = {
  conversationId: string;
  /** The signed-in advisor, so a shared browser keeps drafts apart. */
  userId: string;
  customerName: string;
  advisorName: string;
  dealershipName: string;
  /** null when the customer has no vehicle linked. */
  unit: string | null;
  department: Department;
  templates: Template[];
  disabled?: boolean;
  demoBlocked?: boolean;
  /** The last reply staff wrote that the customer never received, if any. */
  unsentBody?: string | null;
};

const EMPTY_DRAFT: Draft = { body: "", blanks: [] };

function readStoredDraft(key: string): Draft | null {
  try {
    return parseDraft(window.localStorage.getItem(key), Date.now());
  } catch {
    return null;
  }
}

/** Whether the browser kept it. A private window or a locked-down profile throws. */
function writeStoredDraft(key: string, draft: Draft): boolean {
  try {
    const payload = serializeDraft(draft, Date.now());

    if (payload === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, payload);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Drop an entry the read path refuses - past its twelve hours, or
 * unrecognisable - because it is unsent customer-facing text that is never
 * going back in the box. Only this advisor's entry for this thread: sign-out
 * owns the rest of her keys, and nobody owns anyone else's.
 */
function purgeUnusableDraft(key: string) {
  try {
    const raw = window.localStorage.getItem(key);

    if (raw !== null && parseDraft(raw, Date.now()) === null) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage is unavailable, so there is nothing stored to remove.
  }
}

// The stored draft only exists in the browser, so the server render has to be
// the empty box and the first client render has to match it. These three feed
// the standard "am I hydrated yet" read.
const noStoreToSubscribeTo = () => () => {};
const onTheClient = () => true;
const onTheServer = () => false;

export function MessageComposer({
  conversationId,
  userId,
  customerName,
  advisorName,
  dealershipName,
  unit,
  department,
  templates,
  disabled,
  demoBlocked,
  unsentBody,
}: MessageComposerProps) {
  const router = useRouter();
  // What she has typed here in this visit, or null while the box is still
  // showing whatever she left behind last time.
  const [edited, setEdited] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Whether this browser has actually kept anything. Held here and set from the
  // storage calls themselves, because a browser that reads and refuses to write
  // is the one that leaves "Saved as a draft on this device." sitting over text
  // that was never stored.
  const [storageWorks, setStorageWorks] = useState(true);

  const hydrated = useSyncExternalStore(noStoreToSubscribeTo, onTheClient, onTheServer);

  const storageKey = draftStorageKey(userId, conversationId);

  // Until she touches the box it shows the reply she was part-way through when
  // she last left this thread. The queue on the left is how she checks
  // anything, and clicking it used to hand the text back as an empty box.
  const stored = hydrated && !edited ? readStoredDraft(storageKey) : null;
  const draft = edited ?? stored ?? EMPTY_DRAFT;
  // Blanks travel with the body rather than in their own state, so a draft put
  // back after a reload still knows which brackets Attend left and which are
  // her own words.
  const { body, blanks } = draft;

  const unfilled = useMemo(() => remainingBlanks(body, blanks), [body, blanks]);

  // Refused before Send rather than after it. The route refuses too, but by then
  // she has already pressed the button and the reply reads as broken software.
  const overBy = smsOverBy(body);

  // The unsent reply is only worth offering back while the box is empty. Once
  // she has started typing, replacing what she wrote would cost more than the
  // retyping it saves.
  const canRestoreUnsent = Boolean(unsentBody) && !body.trim() && !disabled && !demoBlocked && !isPending;

  // A draft too old to put back is cleared rather than left behind: the read
  // above already refused it, and a shared front-desk browser must not still be
  // holding it tomorrow for whoever signs in next. This one stays an effect
  // because it is storage being tidied on the way in and nothing on screen
  // waits on the answer.
  useEffect(() => {
    purgeUnusableDraft(storageKey);
  }, [storageKey]);

  // Keeping the draft is what her typing does, not what rendering does, so the
  // write lives with the edit instead of in an effect watching for one. Two
  // things follow. Nothing is written until she has actually edited something,
  // so the first renders - before hydration has had a chance to read - cannot
  // erase the stored draft. And the reassurance below is never shown over a
  // write that has already failed, because both land in the same render.
  function commitDraft(next: Draft) {
    setEdited(next);
    setStorageWorks(writeStoredDraft(storageKey, next));
  }

  const availableTemplates = useMemo(
    () => templates.filter((template) => template.department === department || template.department === "GENERAL"),
    [department, templates],
  );

  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);

    if (!template) {
      return;
    }

    const filled = fillTemplate(template.body, { customerName, advisorName, dealershipName, unit });

    commitDraft({ body: filled.body, blanks: filled.blanks });
    setError(null);

    // Put the cursor on the first blank so filling it in is the next keystroke
    // rather than a hunt through the sentence.
    const first = filled.blanks[0];

    if (first) {
      const start = filled.body.indexOf(first);

      requestAnimationFrame(() => {
        bodyRef.current?.focus();
        bodyRef.current?.setSelectionRange(start, start + first.length);
      });
    }
  }

  async function sendMessage() {
    if (!body.trim() || unfilled.length > 0 || overBy > 0) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "The message was not sent. Nothing reached the customer.");
        // The send already recorded the attempt as undelivered, so refresh to put
        // it in the thread where she will still see it after leaving this screen.
        router.refresh();
        return;
      }

      // An empty edit rather than no edit: it clears the box and, with it, the
      // stored draft the sent reply came from.
      commitDraft(EMPTY_DRAFT);
      router.refresh();
    });
  }

  return (
    <div className="border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      {canRestoreUnsent ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-950/50 dark:text-red-100 dark:ring-red-900">
          <span>{customerName} never got your last reply.</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => setEdited({ body: unsentBody ?? "", blanks: [] })}>
            Rewrite it
          </Button>
        </div>
      ) : null}
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div>
          <Label htmlFor="template">Template</Label>
          <Select
            id="template"
            defaultValue=""
            onChange={(event) => {
              applyTemplate(event.target.value);
              // Back to the prompt so the same template can be picked again
              // after a botched blank, and so the box - not the dropdown - is
              // the draft.
              event.target.value = "";
            }}
          >
            <option value="">Choose a template</option>
            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Textarea
          ref={bodyRef}
          value={body}
          onChange={(event) => commitDraft({ body: event.target.value, blanks })}
          placeholder={
            demoBlocked
              ? "SMS sending is disabled in demo mode."
              : disabled
                ? "Customer is opted out of SMS."
                : "Type a customer message..."
          }
          disabled={disabled || demoBlocked || isPending}
          className="min-h-20"
        />
        <Button
          size="icon"
          onClick={sendMessage}
          disabled={disabled || demoBlocked || isPending || !body.trim() || unfilled.length > 0 || overBy > 0}
          title="Send message"
          className="mt-auto"
        >
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </div>
      {unfilled.length > 0 ? (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          Fill in {listBlanks(unfilled)} before sending. Attend does not know {unfilled.length > 1 ? "those" : "that"}, so it
          never guesses.
        </p>
      ) : null}
      {overBy > 0 ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{smsTooLongMessage(overBy)}</p> : null}
      {demoBlocked ? (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          Demo mode: outbound SMS is turned off so no real texts are sent. Everything else is live.
        </p>
      ) : disabled ? (
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          This customer has opted out with STOP. They must text START before staff can send again.
        </p>
      ) : null}
      {/* Says out loud that leaving the thread is safe - the reassurance is
          most of the point - and it is what makes an already-filled box she
          comes back to read as her own draft rather than a reply she sent. */}
      {storageWorks && body.trim() ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">
          Saved as a draft on this device.
          <button
            type="button"
            onClick={() => commitDraft(EMPTY_DRAFT)}
            className="font-medium underline underline-offset-2 transition hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Discard draft
          </button>
        </p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
