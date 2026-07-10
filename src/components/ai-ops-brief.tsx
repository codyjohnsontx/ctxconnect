"use client";

import { useState, useTransition } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Department, Priority } from "@/generated/prisma/client";
import { cn, labelize } from "@/lib/utils";

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

type AiOpsBriefProps = {
  conversationId: string;
  initialInsight?: AiOpsBriefInsight | null;
};

const riskTone: Record<Priority, "neutral" | "green" | "amber" | "red" | "blue"> = {
  LOW: "green",
  NORMAL: "neutral",
  HIGH: "amber",
  URGENT: "red",
};

function riskReasons(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function AiOpsBrief({ conversationId, initialInsight = null }: AiOpsBriefProps) {
  const router = useRouter();
  const [insight, setInsight] = useState<AiOpsBriefInsight | null>(initialInsight);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
          setError(payload?.error ?? "AI brief could not be generated.");
          return;
        }

        if (payload?.insight) {
          setInsight(payload.insight);
          router.refresh();
        }
      } catch {
        setError("AI brief request failed. Check your connection and try again.");
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
        setError("AI action could not be recorded.");
        return false;
      }
    } catch {
      setError("AI action could not be recorded. Check your connection and try again.");
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
        setError("Suggested reply could not be copied.");
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
    if (!insight?.suggestedTaskTitle) {
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

  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-300" />
            <h3 className="text-sm font-semibold">AI Ops Brief</h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            Summarize risk and next action for this thread.
          </p>
        </div>
        {insight ? <Badge variant={riskTone[insight.riskLevel]}>{labelize(insight.riskLevel)}</Badge> : null}
      </div>

      {isPending && !insight ? (
        <div className="space-y-2">
          <div className="h-3 w-4/5 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-16 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800" />
        </div>
      ) : null}

      {!insight && !isPending ? (
        <Button onClick={generateBrief} disabled={isPending} variant="secondary" className="w-full">
          <Sparkles className="h-4 w-4" />
          Generate brief
        </Button>
      ) : null}

      {insight ? (
        <div className="space-y-3 text-sm">
          <BriefField label="Summary" value={insight.summary} />
          <BriefField label="Customer need" value={insight.customerNeed} />
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Risk</div>
            <div className="space-y-1 rounded-md bg-white p-2 dark:bg-zinc-950">
              {riskReasons(insight.riskReasons).length === 0 ? (
                <p className="text-zinc-500 dark:text-zinc-400">No specific risk reasons returned.</p>
              ) : (
                riskReasons(insight.riskReasons).map((reason) => (
                  <p key={reason} className="leading-5 text-zinc-700 dark:text-zinc-300">
                    {reason}
                  </p>
                ))
              )}
            </div>
          </div>
          <BriefField
            label="Escalation"
            value={
              insight.escalationRecommended
                ? insight.escalationReason ?? "Escalation recommended."
                : "No escalation recommended."
            }
          />
          <BriefField
            label="Suggested next action"
            value={
              insight.suggestedDepartment
                ? `${labelize(insight.suggestedDepartment)}: ${insight.suggestedNextAction}`
                : insight.suggestedNextAction
            }
          />
          <BriefField label="Suggested reply" value={insight.suggestedReply ?? "No customer reply recommended."} />
          <BriefField label="Suggested follow-up" value={insight.suggestedTaskTitle ?? "No follow-up task recommended."} />

          <div className="grid grid-cols-2 gap-2">
            <Button onClick={accept} disabled={isPending || Boolean(insight.acceptedAt)} variant="secondary" size="sm">
              <Check className="h-3.5 w-3.5" />
              Accept
            </Button>
            <Button onClick={dismiss} disabled={isPending || Boolean(insight.dismissedAt)} variant="ghost" size="sm">
              <ThumbsDown className="h-3.5 w-3.5" />
              Dismiss
            </Button>
            <Button onClick={copyReply} disabled={isPending || !insight.suggestedReply} variant="secondary" size="sm">
              <Copy className="h-3.5 w-3.5" />
              Copy reply
            </Button>
            <Button onClick={useAsNote} disabled={isPending} variant="secondary" size="sm">
              <StickyNote className="h-3.5 w-3.5" />
              Use note
            </Button>
            <Button onClick={useAsFollowUp} disabled={isPending || !insight.suggestedTaskTitle} variant="secondary" size="sm" className="col-span-2">
              <Clipboard className="h-3.5 w-3.5" />
              Use as follow-up
            </Button>
          </div>

          <Button onClick={generateBrief} disabled={isPending} variant="ghost" size="sm" className="w-full">
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate new brief
          </Button>
        </div>
      ) : null}

      {error ? (
        <p
          className={cn(
            "mt-3 rounded-md p-2 text-xs leading-5",
            error.includes("not configured")
              ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
              : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200",
          )}
        >
          {error}
        </p>
      ) : null}
      {notice ? <p className="mt-3 rounded-md bg-blue-50 p-2 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-200">{notice}</p> : null}
    </section>
  );
}

function BriefField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <p className="rounded-md bg-white p-2 leading-5 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">{value}</p>
    </div>
  );
}
