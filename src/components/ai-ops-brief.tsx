"use client";

import { type ReactNode, useState, useTransition } from "react";
import {
  Check,
  Clipboard,
  Copy,
  Loader2,
  Sparkles,
  StickyNote,
  ThumbsDown,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Department, Priority } from "@/generated/prisma/client";
import { findMatchingFollowUp } from "@/lib/follow-ups";
import { labelize } from "@/lib/utils";

type AiInsightAction = "ACCEPTED" | "DISMISSED" | "REPLY_COPIED";

type AiOpsBriefInsight = {
  id: string;
  model: string;
  summary: string;
  customerNeed: string;
  riskLevel: Priority;
  riskReasons: unknown;
  escalationRecommended: boolean;
  escalationReason: string | null;
  suggestedDepartment: Department | null;
  suggestedNextAction: string;
  suggestedReply: string | null;
  suggestedTaskTitle: string | null;
  confidence: number;
  acceptedAt?: string | Date | null;
  dismissedAt?: string | Date | null;
};

type OpenFollowUp = {
  id: string;
  title: string;
  /** Pre-formatted on the server so it reads the same as the follow-up list. */
  dueLabel: string;
};

type AiOpsBriefProps = {
  conversationId: string;
  initialInsight?: AiOpsBriefInsight | null;
  /**
   * The thread's still-open follow-ups. The brief recommends a follow-up from
   * the same thread history that produced them, so it regularly recommends one
   * that is already on the board; without this the panel would happily stack a
   * second copy of it.
   */
  openFollowUps?: readonly OpenFollowUp[];
  /**
   * Whether `initialInsight` still describes the thread's newest activity. The
   * verdict is threaded as a value rather than computed here: it comes from the
   * same `hasCurrentBrief` predicate the inbox row and the queue counter use,
   * and that predicate sits beside the ambient pass, which imports prisma and
   * must not be pulled into the client bundle.
   */
  briefIsCurrent?: boolean;
};

// The AI speaks in the info tone, so a Normal risk is info rather than neutral:
// neutral is for a brief that no longer describes the thread.
const riskTone: Record<Priority, BadgeVariant> = {
  LOW: "success",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "critical",
};

function riskReasons(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * The brief as one section of the thread's panel. The panel owns the section's
 * padding and rule, the same as every section beside it, so this renders only
 * what goes inside.
 */
export function AiOpsBrief({
  conversationId,
  initialInsight = null,
  openFollowUps = [],
  briefIsCurrent = true,
}: AiOpsBriefProps) {
  const router = useRouter();
  const [insight, setInsight] = useState<AiOpsBriefInsight | null>(initialInsight);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // The verdict describes the brief the server rendered. A brief generated here
  // has just read the whole thread, so it is current until the next server
  // render says otherwise.
  const showsEarlierBrief = insight?.id === initialInsight?.id && !briefIsCurrent;
  const trackedFollowUp = findMatchingFollowUp(insight?.suggestedTaskTitle, openFollowUps);

  async function generateBrief() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/ai/ops-brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        });

        const payload = (await response.json().catch(() => null)) as {
          insight?: AiOpsBriefInsight;
          error?: string;
        } | null;

        if (!response.ok) {
          setError({
            message: payload?.error ?? "AI brief could not be generated.",
            status: response.status,
          });
          return;
        }

        if (payload?.insight) {
          setInsight(payload.insight);

          // A new brief invalidates any insight attribution staged in the
          // note / follow-up forms; clear it so stale IDs cannot be submitted.
          for (const selector of ["input[data-ai-note-insight]", "input[data-ai-follow-up-insight]"]) {
            const staged = document.querySelector<HTMLInputElement>(selector);

            if (staged) {
              staged.value = "";
            }
          }

          router.refresh();
        }
      } catch {
        setError({ message: "AI brief request failed. Check your connection and try again." });
      }
    });
  }

  async function recordAction(action: AiInsightAction) {
    if (!insight) {
      return false;
    }

    try {
      const response = await fetch(`/api/ai/ops-brief/${insight.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        setError({ message: "AI action could not be recorded.", status: response.status });
        return false;
      }
    } catch {
      setError({ message: "AI action could not be recorded. Check your connection and try again." });
      return false;
    }

    setError(null);
    router.refresh();
    return true;
  }

  function accept() {
    setNotice(null);
    startTransition(async () => {
      if (await recordAction("ACCEPTED")) {
        setInsight((current) =>
          current ? { ...current, acceptedAt: new Date().toISOString(), dismissedAt: null } : current,
        );
        setNotice("Recommendation accepted.");
      }
    });
  }

  function dismiss() {
    setNotice(null);
    startTransition(async () => {
      if (await recordAction("DISMISSED")) {
        setInsight((current) =>
          current ? { ...current, acceptedAt: null, dismissedAt: new Date().toISOString() } : current,
        );
        setNotice("Recommendation dismissed.");
      }
    });
  }

  function copyReply() {
    if (!insight?.suggestedReply) {
      return;
    }

    setNotice(null);
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(insight.suggestedReply ?? "");
      } catch {
        setError({ message: "Suggested reply could not be copied." });
        return;
      }

      if (await recordAction("REPLY_COPIED")) {
        setNotice("Suggested reply copied.");
      }
    });
  }

  function useAsNote() {
    if (!insight) {
      return;
    }

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    const aiInsightInput = document.querySelector<HTMLInputElement>("input[data-ai-note-insight]");

    if (textarea) {
      textarea.value = insight.suggestedNextAction;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
    }

    if (aiInsightInput) {
      aiInsightInput.value = insight.id;
    }

    setNotice(null);
    setNotice(textarea ? "Internal note draft filled." : insight.suggestedNextAction);
  }

  function useAsFollowUp() {
    if (!insight?.suggestedTaskTitle || trackedFollowUp) {
      return;
    }

    const input = document.querySelector<HTMLInputElement>('input[name="title"]');
    const aiInsightInput = document.querySelector<HTMLInputElement>("input[data-ai-follow-up-insight]");

    if (input) {
      input.value = insight.suggestedTaskTitle;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }

    if (aiInsightInput) {
      aiInsightInput.value = insight.id;
    }

    setNotice(null);
    setNotice(input ? "Follow-up title filled." : insight.suggestedTaskTitle ?? null);
  }

  const reasons = insight ? riskReasons(insight.riskReasons) : [];

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        title={
          <>
            <Sparkles className="size-3.5 text-info" aria-hidden="true" />
            AI Ops Brief
          </>
        }
        trailing={
          insight ? (
            <Badge variant={showsEarlierBrief ? "neutral" : riskTone[insight.riskLevel]}>
              {showsEarlierBrief ? `${labelize(insight.riskLevel)} · earlier brief` : labelize(insight.riskLevel)}
            </Badge>
          ) : null
        }
      />

      {isPending && !insight ? (
        <div className="flex flex-col gap-2">
          <div className="h-3 w-4/5 animate-pulse rounded-sm bg-surface-strong" />
          <div className="h-3 w-2/3 animate-pulse rounded-sm bg-surface-strong" />
          <div className="h-16 animate-pulse rounded-md bg-surface-strong" />
        </div>
      ) : null}

      {!insight && !isPending ? (
        <Button onClick={generateBrief} disabled={isPending} variant="secondary" className="w-full">
          <Sparkles className="size-3.5" />
          Generate brief
        </Button>
      ) : null}

      {insight ? (
        <>
          <dl className="flex flex-col gap-3">
            <BriefField label="Summary">{insight.summary}</BriefField>
            <BriefField label="Customer need">{insight.customerNeed}</BriefField>
            <BriefField label="Risk">
              {reasons.length === 0 ? (
                <span className="text-text-muted">No specific risk reasons returned.</span>
              ) : (
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </BriefField>
            <BriefField label="Escalation">
              {insight.escalationRecommended
                ? insight.escalationReason ?? "Escalation recommended."
                : "No escalation recommended."}
            </BriefField>
            <BriefField label="Suggested next action">
              {insight.suggestedDepartment
                ? `${labelize(insight.suggestedDepartment)}: ${insight.suggestedNextAction}`
                : insight.suggestedNextAction}
            </BriefField>
            <BriefField label="Suggested reply">{insight.suggestedReply ?? "No customer reply recommended."}</BriefField>
            <BriefField
              label="Suggested follow-up"
              note={trackedFollowUp ? `Already on this thread, due ${trackedFollowUp.dueLabel}.` : null}
            >
              {insight.suggestedTaskTitle ?? "No follow-up task recommended."}
            </BriefField>
          </dl>

          <div className="flex flex-wrap gap-1">
            <Button onClick={accept} disabled={isPending || Boolean(insight.acceptedAt)} variant="secondary" size="sm">
              <Check className="size-3.5" />
              Accept
            </Button>
            <Button onClick={copyReply} disabled={isPending || !insight.suggestedReply} variant="secondary" size="sm">
              <Copy className="size-3.5" />
              Copy reply
            </Button>
            <Button onClick={useAsNote} disabled={isPending} variant="secondary" size="sm">
              <StickyNote className="size-3.5" />
              Use note
            </Button>
            {/* Not a disabled button: "there is already one of these" is only
                useful if she can get to the one that exists, read its due date
                and see who owns it. It is on this same panel, so the control
                takes her to it rather than going dead. */}
            {trackedFollowUp ? (
              <ButtonLink href={`#follow-up-${trackedFollowUp.id}`} variant="secondary" size="sm">
                <Check className="size-3.5" />
                See the follow-up
              </ButtonLink>
            ) : (
              <Button
                onClick={useAsFollowUp}
                disabled={isPending || !insight.suggestedTaskTitle}
                variant="secondary"
                size="sm"
              >
                <Clipboard className="size-3.5" />
                Use as follow-up
              </Button>
            )}
            <Button onClick={dismiss} disabled={isPending || Boolean(insight.dismissedAt)} variant="tertiary" size="sm">
              <ThumbsDown className="size-3.5" />
              Dismiss
            </Button>
            <Button onClick={generateBrief} disabled={isPending} variant="tertiary" size="sm">
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Generate new brief
            </Button>
          </div>
        </>
      ) : null}

      {/* The live regions stay mounted so a screen reader hears each notice
          arrive; a region rendered together with its text is not announced.
          The -mt-3 cancels the column's gap while both are empty, and each
          notice brings the gap back with its own mt-3. */}
      <div className="-mt-3">
        <div role="alert">
          {error ? (
            <Alert
              variant={error.status === 429 || error.status === 503 ? "warning" : "critical"}
              inline
              className="mt-3"
            >
              {error.message}
            </Alert>
          ) : null}
        </div>
        <div role="status" aria-live="polite">
          {notice ? (
            <Alert variant="success" inline className="mt-3">
              {notice}
            </Alert>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BriefField({
  label,
  note = null,
  children,
}: {
  label: string;
  note?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="mb-1 text-200 font-medium text-text-muted">{label}</dt>
      <dd className="leading-5">{children}</dd>
      {note ? <dd className="mt-1 text-200 text-warning">{note}</dd> : null}
    </div>
  );
}
