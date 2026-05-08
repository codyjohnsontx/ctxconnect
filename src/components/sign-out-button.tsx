"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void signOut({ callbackUrl: "/login" })}
      title="Sign out"
    >
      <LogOut className="h-4 w-4" />
      <span className="hidden lg:inline">Sign out</span>
    </Button>
  );
}
