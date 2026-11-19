import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const variants = {
  info: { box: "border-info-border border-l-info bg-info-surface", icon: Info, tint: "text-info" },
  success: {
    box: "border-success-border border-l-success bg-success-surface",
    icon: CheckCircle2,
    tint: "text-success",
  },
  warning: {
    box: "border-warning-border border-l-warning bg-warning-surface",
    icon: AlertTriangle,
    tint: "text-warning",
  },
  critical: {
    box: "border-critical-border border-l-critical bg-critical-surface",
    icon: XCircle,
    tint: "text-critical",
  },
};

export type AlertVariant = keyof typeof variants;

type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  variant?: AlertVariant;
  /** The one-line statement; the body under it says what to do about it. */
  title?: ReactNode;
  /** Tighter padding and a smaller radius, for a notice inside a panel. */
  inline?: boolean;
  /** One control at the trailing edge, such as a dismiss button. */
  action?: ReactNode;
};

/**
 * A notice that stays on the page: a hand-off, demo mode, a failed send. The
 * tone names what happened, the left edge carries it, and the text stays the
 * page's own colour so the notice reads as a sentence rather than a banner.
 */
export function Alert({
  className,
  variant = "info",
  title,
  inline = false,
  action,
  children,
  ...props
}: AlertProps) {
  const { box, icon: Icon, tint } = variants[variant];

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-l-3 text-200 text-text",
        inline ? "rounded-sm px-2 py-1" : "px-3 py-2",
        box,
        className,
      )}
      {...props}
    >
      <Icon className={cn("mt-px size-3.5 shrink-0", tint)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <div className="font-semibold">{title}</div> : null}
        {children ? <div className="text-text-muted">{children}</div> : null}
      </div>
      {action ? <div className="-my-1 -mr-1 shrink-0">{action}</div> : null}
    </div>
  );
}

type ToastProps = Omit<AlertProps, "inline"> & {
  onDismiss?: () => void;
};

/** An alert that floats and goes away: it keeps the tone's border, sits on the plain surface and casts the one mid shadow. */
export function Toast({ className, onDismiss, ...props }: ToastProps) {
  return (
    <Alert
      role="status"
      aria-live="polite"
      className={cn("max-w-(--layout-queue-width) bg-surface shadow-mid", className)}
      action={
        onDismiss ? (
          <Button variant="tertiary" size="icon" className="h-7 w-7" onClick={onDismiss} aria-label="Dismiss">
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null
      }
      {...props}
    />
  );
}
