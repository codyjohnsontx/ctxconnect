"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { isDraftKeyFor } from "@/lib/drafts";

/**
 * Take this advisor's unsent replies off the machine.
 *
 * A draft is customer-facing text that names the customer and their unit, and a
 * dealership front desk is one browser several people sign into across a day.
 * Keying drafts by user already stops the next person reading them in the app;
 * this stops them being on the machine at all once she has gone home. Best
 * effort by design - a browser that refuses storage must not block sign-out.
 */
function forgetDrafts(userId: string) {
  try {
    const keys = Object.keys(window.localStorage).filter((key) => isDraftKeyFor(key, userId));

    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage is unavailable, so there is nothing stored to remove.
  }
}

export function SignOutButton({ userId }: { userId: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        forgetDrafts(userId);
        void signOut({ callbackUrl: "/login" });
      }}
      title="Sign out"
    >
      <LogOut className="h-4 w-4" />
      {/* Named rather than an icon on its own: on a phone this is the only
          way out of someone else's account, and it is read once, in a hurry. */}
      <span>Sign out</span>
    </Button>
  );
}
