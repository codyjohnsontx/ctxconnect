"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, ContactRound, Inbox, LayoutDashboard, MessageSquareText, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type NavCounts = { inbox: number; tasks: number; command: number };

const navItems: Array<{
  href: string;
  label: string;
  icon: typeof Inbox;
  countKey?: keyof NavCounts;
}> = [
  { href: "/inbox", label: "Inbox", icon: Inbox, countKey: "inbox" },
  { href: "/customers", label: "Customers", icon: ContactRound },
  { href: "/tasks", label: "Tasks", icon: ClipboardList, countKey: "tasks" },
  { href: "/templates", label: "Templates", icon: MessageSquareText },
  { href: "/command-center", label: "Command", icon: LayoutDashboard, countKey: "command" },
  { href: "/settings", label: "Settings", icon: Settings },
];

function showsTo(href: string, role: string) {
  return href !== "/settings" || role === "ADMIN" || role === "MANAGER";
}

/**
 * The shell's links, in the side nav or the phone bar. A client component
 * because the shell sits in the shared (app) layout, which Next does not
 * re-render on a client-side navigation: only the browser's own pathname
 * follows the advisor from page to page.
 */
export function NavLinks({ variant, role, counts }: { variant: "side" | "bar"; role: string; counts: NavCounts }) {
  const pathname = usePathname() ?? "";

  return navItems
    .filter((item) => showsTo(item.href, role))
    .map((item) => {
      const active = pathname.startsWith(item.href);
      const Icon = item.icon;
      const count = item.countKey ? counts[item.countKey] : 0;

      if (variant === "bar") {
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "relative flex min-w-0 flex-col items-center justify-center gap-1",
              active ? "text-accent" : "text-text-muted",
            )}
          >
            <Icon className="size-5" />
            {count > 0 ? (
              <Badge count variant="critical" className="absolute top-1 left-1/2 ml-1">
                {count}
              </Badge>
            ) : null}
            <span className="max-w-full truncate px-1 text-100 font-medium">{item.label}</span>
          </Link>
        );
      }

      return (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md px-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring",
            active ? "bg-accent-surface text-accent" : "text-text-muted hover:bg-surface-strong hover:text-text",
          )}
        >
          <Icon className="size-4" />
          <span className="flex-1">{item.label}</span>
          {count > 0 ? (
            <Badge count className={cn("bg-surface", active && "border-accent-border text-accent")}>
              {count}
            </Badge>
          ) : null}
        </Link>
      );
    });
}
