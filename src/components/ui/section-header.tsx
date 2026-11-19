import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  title: ReactNode;
  /** `lg` is a page or column title; the default heads a panel section. */
  size?: "default" | "lg";
  /** The heading element; defaults to h2 for `lg` and h3 otherwise. */
  as?: "h1" | "h2" | "h3";
  /** One count or state word beside the title, in muted text. */
  meta?: ReactNode;
  /** One action, usually a tertiary button or link. */
  children?: ReactNode;
  className?: string;
};

/**
 * A title with at most one count or action beside it. No eyebrow above, no
 * sub-line under: if a section needs explaining, the explanation belongs in
 * its body.
 */
export function SectionHeader({ title, size = "default", as, meta, children, className }: SectionHeaderProps) {
  const Heading = as ?? (size === "lg" ? "h2" : "h3");

  return (
    <div className={cn("flex min-h-7 items-center justify-between gap-2", className)}>
      <Heading
        className={cn(
          "flex min-w-0 items-center gap-1 font-semibold text-text",
          size === "lg" ? "text-500 tracking-tight" : "text-300",
        )}
      >
        {title}
      </Heading>
      {meta != null || children ? (
        <div className="flex shrink-0 items-center gap-2">
          {meta != null ? <span className="text-200 text-text-muted">{meta}</span> : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
