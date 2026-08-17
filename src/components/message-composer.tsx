"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { SendHorizonal } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/field";
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

export function MessageComposer({
  conversationId,
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
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Blanks the last applied template left behind, so a draft can be checked for
  // the ones Attend put there without treating her own brackets as unfinished.
  const [blanks, setBlanks] = useState<string[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const unfilled = useMemo(() => remainingBlanks(body, blanks), [body, blanks]);

  // Refused before Send rather than after it. The route refuses too, but by then
  // she has already pressed the button and the reply reads as broken software.
  const overBy = smsOverBy(body);

  // The unsent reply is only worth offering back while the box is empty. Once
  // she has started typing, replacing what she wrote would cost more than the
  // retyping it saves.
  const canRestoreUnsent = Boolean(unsentBody) && !body.trim() && !disabled && !demoBlocked && !isPending;

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

    setBody(filled.body);
    setBlanks(filled.blanks);
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

      setBody("");
      setBlanks([]);
      router.refresh();
    });
  }

  return (
    <div className="border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      {canRestoreUnsent ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-950/50 dark:text-red-100 dark:ring-red-900">
          <span>{customerName} never got your last reply.</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => setBody(unsentBody ?? "")}>
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
          onChange={(event) => setBody(event.target.value)}
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
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
