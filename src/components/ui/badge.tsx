import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * What each tone means in Attend, so nobody decides per screen:
 * success is consent granted, a closed thread, a confirmation; warning is a
 * human note, an open follow-up, waiting on the customer, High risk; critical
 * is Urgent, a failed send, waiting on staff, overdue, opted out or no consent;
 * info is the AI's voice and an open thread; accent is Attend's own, for the
 * selected or active thing; neutral is a department, a tag, or not briefed.
 */
const variants = {
  neutral: "border-border bg-surface-strong text-text-muted",
  success: "border-success-border bg-success-surface text-success",
  warning: "border-warning-border bg-warning-surface text-warning",
  critical: "border-critical-border bg-critical-surface text-critical",
  info: "border-info-border bg-info-surface text-info",
  accent: "border-accent-border bg-accent-surface text-accent",
};

export type BadgeVariant = keyof typeof variants;

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  /** A number rather than a word: a round pill with tabular digits. */
  count?: boolean;
};

export function Badge({ className, variant = "neutral", count = false, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-4 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-100 font-medium",
        variants[variant],
        count && "min-w-4 justify-center rounded-full px-1 tabular-nums",
        className,
      )}
      {...props}
    />
  );
}
