"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { UserRoundCheck } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { accountFullName, accountInitials, accountShortName } from "@/lib/account-identity";
import { labelize } from "@/lib/utils";

type AccountMenuProps = {
  userId: string;
  name?: string | null;
  role: string;
};

/**
 * Following a link out of the panel is the one exit the popover cannot see.
 *
 * The click is inside it, so light-dismiss does not fire, and Next does not
 * re-render the shared (app) layout when navigating between routes inside it -
 * the same fact the coverage page's own guard turns on - so nothing unmounts
 * the element and it stays in the top layer, a card floating over the page it
 * just opened.
 *
 * Handled on the panel rather than on any one link, so every entry the menu
 * grows behaves the same. Only anchors close it: the theme toggle deliberately
 * leaves it open, so the advisor can see the choice she just made against the
 * panel's own background. Sign out is a full document navigation and unmounts
 * everything either way.
 */
function closeWhenFollowingALink(event: MouseEvent<HTMLDivElement>) {
  if ((event.target as HTMLElement).closest("a[href]")) {
    event.currentTarget.hidePopover();
  }
}

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
        className="relative flex min-w-0 flex-col items-center justify-center gap-1 text-text-muted"
      >
        <span
          aria-hidden="true"
          className="flex size-5 items-center justify-center rounded-full bg-surface-strong text-[9px] font-semibold text-text-muted"
        >
          {accountInitials(name)}
        </span>
        {/* Sized on the span rather than the button: `globals.css` resets
            `button { font: inherit }` outside every layer, so a `text-*`
            utility on the control itself never reaches the label and the name
            would set at the body's size beside 11px navigation labels. */}
        <span className="max-w-full truncate px-1 text-100 font-medium">
          {accountShortName(name)}
        </span>
      </button>

      {/* Positioned by hand rather than by anchor: it always sits directly above
          the bar its trigger lives in, as wide as the sidebar it stands in for,
          which is what "Dark" and "Sign out" need to sit on one line. The one
          mid shadow in the app: this floats, so it is allowed one.

          Hidden outright where the popover API is missing: the `popover`
          attribute is ignored there, so this would render inline and sit open
          over the bottom bar with no way to dismiss it. The cell then does
          nothing, which is where sign out on such a phone already was. */}
      <div
        id="account-menu"
        popover="auto"
        onClick={closeWhenFollowingALink}
        className="inset-auto right-2 bottom-16 left-auto m-0 w-(--layout-nav-width) rounded-md border border-border bg-surface p-4 text-text shadow-mid not-supports-[selector(:popover-open)]:hidden"
      >
        {/* The stack lives on an inner element: a display utility on the
            popover itself would beat the user-agent rule that keeps a closed
            popover hidden, and it would sit open over the bar on every page. */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-strong text-100 font-semibold text-text-muted"
            >
              {accountInitials(name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{accountFullName(name)}</span>
              <span className="block text-200 text-text-muted">{labelize(role)}</span>
            </span>
          </div>
          <Link
            href="/coverage"
            className="inline-flex items-center gap-1 self-start text-200 font-medium text-text-muted underline-offset-2 transition-colors hover:text-text hover:underline"
          >
            <UserRoundCheck className="size-3.5" />
            Coverage
          </Link>
          <div className="flex gap-2">
            <ThemeToggle />
            <SignOutButton userId={userId} />
          </div>
        </div>
      </div>
    </>
  );
}
