import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { accountFullName, accountInitials, accountShortName } from "@/lib/account-identity";

type AccountMenuProps = {
  userId: string;
  name?: string | null;
  role: string;
};

/**
 * The phone-sized copy of the sidebar's account block.
 *
 * The sidebar it mirrors is `hidden lg:flex`, so on a phone the advisor could
 * neither see whose account she was texting from nor leave it. The trigger
 * carries the first name so the answer is always on screen, and the panel is a
 * native popover: it light-dismisses and closes on Escape without any state of
 * its own.
 */
export function AccountMenu({ userId, name, role }: AccountMenuProps) {
  return (
    <>
      <button
        type="button"
        popoverTarget="account-menu"
        aria-label={`Account: ${accountFullName(name)}`}
        className="relative flex h-16 flex-col items-center justify-center gap-1 text-zinc-500 dark:text-zinc-400"
      >
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          {accountInitials(name)}
        </span>
        {/* Sized on the span rather than the button: `globals.css` resets
            `button { font: inherit }` outside every layer, so a `text-*`
            utility on the control itself never reaches the label and the name
            would set at the body's 16px beside 10px navigation labels. */}
        <span className="max-w-full truncate px-1 text-[10px] font-medium">
          {accountShortName(name)}
        </span>
      </button>

      {/* Positioned by hand rather than by anchor: it always sits directly above
          the bar its trigger lives in. `w-64` and `p-4` give it the sidebar
          account block's own content width, which is what "Dark" and "Sign out"
          need to sit on one line - they set at the body's 16px here too. Lifted
          off the page in dark mode, where zinc-950 is also the page. */}
      <div
        id="account-menu"
        popover="auto"
        className="inset-auto right-2 bottom-20 left-auto m-0 w-64 rounded-md border border-zinc-200 bg-white p-4 text-zinc-950 shadow-lg not-supports-[selector(:popover-open)]:hidden dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{accountFullName(name)}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{role}</div>
        </div>
        <div className="mt-3 flex gap-2">
          <ThemeToggle />
          <SignOutButton userId={userId} />
        </div>
      </div>
    </>
  );
}
