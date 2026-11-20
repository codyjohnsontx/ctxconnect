import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import {
  AlertTriangle,
  ArrowRightLeft,
  ClipboardList,
  Clock3,
  ContactRound,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  UserRoundCheck,
} from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import type { NotificationType } from "@/generated/prisma/client";
import { accountInitials } from "@/lib/account-identity";
import type { getShellData } from "@/lib/data";
import { cn, labelize } from "@/lib/utils";

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

// The one mark of colour on an alert row is its icon, in the tone the alert
// means: critical for what has already gone wrong, warning for what is waiting,
// info for a hand-off.
const alertIcons: Record<NotificationType, { icon: typeof Inbox; tone: string }> = {
  NEW_INBOUND_MESSAGE: { icon: Clock3, tone: "text-warning" },
  CONVERSATION_ASSIGNED: { icon: ArrowRightLeft, tone: "text-info" },
  CONVERSATION_REASSIGNED: { icon: ArrowRightLeft, tone: "text-info" },
  FOLLOW_UP_DUE: { icon: Clock3, tone: "text-warning" },
  FOLLOW_UP_OVERDUE: { icon: AlertTriangle, tone: "text-critical" },
  MESSAGE_FAILED: { icon: AlertTriangle, tone: "text-critical" },
  SLA_MISSED: { icon: AlertTriangle, tone: "text-critical" },
  UNASSIGNED_CONVERSATION: { icon: Inbox, tone: "text-warning" },
};

type AppShellProps = {
  children: ReactNode;
  user: {
    id: string;
    name?: string | null;
    role: string;
  };
  shellData: ShellData;
};

export async function AppShell({ children, user, shellData }: AppShellProps) {
  const pathname = (await headers()).get("x-current-path") ?? "";
  const visibleNavItems = navItems.filter((item) => item.href !== "/settings" || user.role === "ADMIN" || user.role === "MANAGER");
  const mobileNavColumns = visibleNavItems.length + 1;
  // The rail lists every alert it was given and scrolls; on a dealership busy
  // enough to outrun the scan, the badge would otherwise promise work the rail
  // cannot show, so the difference gets a row of its own.
  const unlistedAlerts = Math.max(shellData.counts.command - shellData.latestNotifications.length, 0);

  return (
    <div className="min-h-dvh">
      {/* A shade darker than the content, so the columns read as one tool
          rather than as cards laid side by side. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-(--layout-nav-width) border-r border-border bg-surface-raised lg:flex lg:flex-col">
        <div className="border-b border-border px-4 py-3">
          <Link href="/inbox" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-accent text-400 font-semibold text-text-on-accent">
              A
            </span>
            <span className="text-400 font-semibold tracking-tight">Attend</span>
          </Link>
        </div>

        <nav className="flex flex-col gap-px p-2">
          {visibleNavItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            const count = item.countKey ? shellData.counts[item.countKey] : 0;
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
          })}
        </nav>

        <div className="flex min-h-0 flex-1 flex-col border-t border-border px-2 pt-2 pb-3">
          {/* The heading is the way out of the rail: a short screen cuts the
              list off wherever it runs out of room, so the number always has a
              destination that can show all of it. */}
          <Link
            href="/command-center#alerts"
            className="mb-px flex items-center justify-between rounded-md px-2 py-1 text-200 font-semibold text-text-muted transition-colors hover:bg-surface-strong hover:text-text"
          >
            <span>Alerts</span>
            <Badge count variant={shellData.counts.command > 0 ? "warning" : "success"}>
              {shellData.counts.command}
            </Badge>
          </Link>
          <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
            {shellData.latestNotifications.length === 0 ? (
              <p className="px-2 py-1 text-200 text-text-muted">No active alerts.</p>
            ) : (
              shellData.latestNotifications.map((notification) => {
                const { icon: Icon, tone } = alertIcons[notification.type];
                return (
                  <Link
                    key={notification.id}
                    href={notification.href}
                    className="block rounded-md px-2 py-1 text-200 transition-colors hover:bg-surface-strong"
                  >
                    <span className="flex items-center gap-1 font-medium text-text">
                      <Icon className={cn("size-3 shrink-0", tone)} />
                      <span className="line-clamp-1">{notification.title}</span>
                    </span>
                    <span className="line-clamp-1 text-text-muted">
                      {notification.conversation?.customer.name ?? notification.task?.customer.name ?? notification.body}
                    </span>
                  </Link>
                );
              })
            )}
            {unlistedAlerts > 0 ? (
              <Link
                href="/command-center#alerts"
                className="block rounded-md px-2 py-1 text-200 font-medium text-text-muted underline underline-offset-2 transition-colors hover:bg-surface-strong hover:text-text"
              >
                {unlistedAlerts} more in Command Center
              </Link>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-strong text-100 font-semibold text-text-muted"
            >
              {accountInitials(user.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{user.name}</span>
              <span className="block text-200 text-text-muted">{labelize(user.role)}</span>
            </span>
          </div>
          {/* Not in the navigation: arranging cover is something an advisor does
              on her last day before a holiday, not a place she works from, and
              the phone bar is already at six cells. It lives with the account it
              is about instead. */}
          <Link
            href="/coverage"
            className="inline-flex items-center gap-1 self-start text-200 font-medium text-text-muted underline-offset-2 transition-colors hover:text-text hover:underline"
          >
            <UserRoundCheck className="size-3.5" />
            Coverage
          </Link>
          <div className="flex gap-2">
            <ThemeToggle />
            <SignOutButton userId={user.id} />
          </div>
        </div>
      </aside>

      <main className="min-h-dvh pb-16 lg:pl-(--layout-nav-width) lg:pb-0">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid h-14 border-t border-border bg-surface lg:hidden"
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
        })}
        <AccountMenu userId={user.id} name={user.name} role={user.role} />
      </nav>
    </div>
  );
}
