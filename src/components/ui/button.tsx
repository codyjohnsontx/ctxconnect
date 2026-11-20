import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Colour is reserved for the primary action: one accent button per view, a
 * bordered secondary beside it, a borderless tertiary for the small actions
 * in a header, and critical for the one that cannot be undone.
 */
const variants = {
  primary: "border-accent bg-accent text-text-on-accent hover:border-accent-hover hover:bg-accent-hover",
  secondary: "border-border-strong bg-surface text-text hover:bg-surface-raised",
  tertiary: "border-transparent bg-transparent text-text-muted hover:bg-surface-strong hover:text-text",
  critical: "border-critical bg-surface text-critical hover:bg-critical-surface",
};

// The text classes are unlayered (globals.css), because a text-* utility on a
// <button> loses to the font: inherit reset.
const sizes = {
  sm: "h-7 px-2 ui-control-text-sm",
  md: "h-8 px-3 ui-control-text",
  icon: "h-8 w-8 p-0 ui-control-text",
};

const base =
  "ui-button-text inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md border transition-colors focus-visible:border-focus focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        base,
        "disabled:pointer-events-none disabled:border-border disabled:bg-surface-strong disabled:text-text-faint",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  href,
  ...props
}: ButtonLinkProps) {
  const classes = cn(base, variants[variant], sizes[size], className);
  if (href.startsWith("#")) {
    return <a href={href} className={classes} {...props} />;
  }
  return <Link href={href} className={classes} {...props} />;
}
