import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import {
  ClipboardList,
  ContactRound,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  Settings,
} from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import type { getShellData } from "@/lib/data";
import { cn } from "@/lib/utils";

type ShellData = Awaited<ReturnType<typeof getShellData>>;
type CountKey = keyof ShellData["counts"];

const navItems: Array<{
  href: string;
  label: string;
  icon: typeof Inbox;
  countKey?: CountKey;
}> = [
  { href: "/inbox", label: "Inbox", icon: Inbox, countKey: "inbox" },
  { href: "/customers", label: "Customers", icon: ContactRound },
  { href: "/tasks", label: "Tasks", icon: ClipboardList, countKey: "tasks" },
  { href: "/templates", label: "Templates", icon: MessageSquareText },
  { href: "/command-center", label: "Command", icon: LayoutDashboard, countKey: "command" },
  { href: "/settings", label: "Settings", icon: Settings },
];

type AppShellProps = {
  children: ReactNode;
  user: {
    name?: string | null;
    role: string;
  };
  shellData: ShellData;
};

export async function AppShell({ children, user, shellData }: AppShellProps) {
  const pathname = (await headers()).get("x-current-path") ?? "";
  const visibleNavItems = navItems.filter((item) => item.href !== "/settings" || user.role === "ADMIN" || user.role === "MANAGER");
  const mobileNavColumns = visibleNavItems.length + 1;

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:flex lg:flex-col">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <Link href="/inbox" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-950 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
              CTX
            </div>
            <div>
              <div className="text-sm font-semibold">CTX Chat</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">Dealership inbox</div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {visibleNavItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            const count = item.countKey ? shellData.counts[item.countKey] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition",
                  active
                    ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {count > 0 ? (
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px]", active ? "bg-white/20" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200")}>
                    {count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Latest alerts</p>
            <Badge variant={shellData.counts.command > 0 ? "amber" : "green"}>
              {shellData.counts.command}
            </Badge>
          </div>
          <div className="space-y-1">
            {shellData.latestNotifications.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">No active alerts.</p>
            ) : (
              shellData.latestNotifications.slice(0, 3).map((notification) => (
                <Link
                  key={notification.id}
                  href={notification.href}
                  className="block rounded-md px-2 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                >
                  <span className="line-clamp-1 font-medium">{notification.title}</span>
                  <span className="line-clamp-1 text-zinc-500 dark:text-zinc-500">
                    {notification.conversation?.customer.name ?? notification.task?.customer.name ?? notification.body}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-3 min-w-0">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{user.role}</div>
          </div>
          <div className="flex gap-2">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </aside>

      <main className="min-h-dvh pb-20 lg:pl-64 lg:pb-0">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:hidden"
        style={{ gridTemplateColumns: `repeat(${mobileNavColumns}, minmax(0, 1fr))` }}
      >
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          const count = item.countKey ? shellData.counts[item.countKey] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium",
                active ? "text-zinc-950 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400",
              )}
            >
              <Icon className="h-5 w-5" />
              {count > 0 ? (
                <span className="absolute mt-[-30px] ml-6 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] leading-none text-white">
                  {count}
                </span>
              ) : null}
              <span className="max-w-full truncate px-1">{item.label}</span>
            </Link>
          );
        })}
        <div className="flex h-16 items-center justify-center">
          <ThemeToggle />
        </div>
      </nav>
    </div>
  );
}
