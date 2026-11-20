import type {
  ComponentPropsWithRef,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-200 font-medium text-text-muted", className)} {...props} />;
}

// Form controls size their own text through the unlayered classes in
// globals.css; a text-* utility on them loses to the font: inherit reset.
const control =
  "ui-control-text w-full rounded-md border border-border-strong bg-surface text-text outline-none transition-[border-color,box-shadow] hover:border-text-faint focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-strong disabled:text-text-faint aria-invalid:border-critical";

export function Input({ className, ...props }: ComponentPropsWithRef<"input">) {
  return <input className={cn(control, "h-8 px-2 placeholder:text-text-faint", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  return (
    <textarea
      className={cn(control, "min-h-22 resize-y p-2 placeholder:text-text-faint", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        control,
        "h-8 cursor-pointer appearance-none bg-(image:--select-chevron) bg-position-[right_8px_center] bg-size-[16px] bg-no-repeat pl-2 pr-8",
        className,
      )}
      {...props}
    />
  );
}

type CheckboxProps = Omit<ComponentPropsWithRef<"input">, "type" | "children"> & {
  /** What the box is for; the whole bordered label toggles it. */
  label: ReactNode;
};

/** A bordered, control-height toggle for the filter row: the checked one takes the accent. */
export function Checkbox({ className, label, ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-2 text-300 text-text transition-colors hover:bg-surface-raised has-checked:border-accent-border has-checked:bg-accent-surface has-checked:text-accent has-focus-visible:border-focus has-focus-visible:ring-3 has-focus-visible:ring-focus-ring",
        className,
      )}
    >
      <input type="checkbox" className="m-0 size-3.5 accent-accent focus-visible:outline-none" {...props} />
      {label}
    </label>
  );
}
