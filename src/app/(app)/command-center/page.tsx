import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { getServerSession } from "next-auth";
import { AlertTriangle, Bell, Bike, Clock3, Inbox, MessageSquare, Send, UserX, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { authOptions } from "@/lib/auth";
import { getCommandCenterData } from "@/lib/data";
import { isManagerOrAdmin } from "@/lib/permissions";
import { cn, labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

const metricConfig = [
  { key: "unread", label: "Unread conversations", icon: Inbox, empty: "No unread conversations." },
  { key: "waitingOnStaff", label: "Waiting on staff", icon: AlertTriangle, empty: "No conversations are waiting on staff." },
  { key: "dueToday", label: "Follow-ups due today", icon: Clock3, empty: "No follow-ups are due today." },
  { key: "overdue", label: "Overdue follow-ups", icon: AlertTriangle, empty: "No overdue follow-ups." },
  { key: "unassigned", label: "Unassigned conversations", icon: UserX, empty: "No unassigned conversations." },
  { key: "failedMessages", label: "Failed messages", icon: Send, empty: "No failed messages." },
  { key: "slaMissed", label: "SLA missed", icon: Bell, empty: "No SLA misses." },
  { key: "hotSalesLeads", label: "Hot sales leads", icon: MessageSquare, empty: "No hot sales leads." },
  { key: "serviceWaiting", label: "Service update waits", icon: Bike, empty: "No service customers are waiting." },
  { key: "bikesReady", label: "Bikes ready for pickup", icon: Bike, empty: "No pickup-ready bikes." },
] as const;

type PageProps = {
  searchParams: Promise<{ focus?: string }>;
};

export default async function CommandCenterPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const { focus } = await searchParams;
  const {
    metrics,
    responseHealth,
    visibleConversations,
    latestNotifications,
    selectedFocus,
    focusItems,
    needsAction,
    employeeStats,
  } =
    await getCommandCenterData(session!.user, focus);
  const selectedMetric = metricConfig.find((metric) => metric.key === selectedFocus);
  const canSeeDealershipRollup = isManagerOrAdmin(session!.user);

  return (
    <div className="p-5 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {canSeeDealershipRollup
            ? "Dealership operations view of what needs attention now."
            : "Your scoped operations view of what needs attention now."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metricConfig.map(({ key, label, icon: Icon }) => (
          <Link
            key={key}
            href={`/command-center?focus=${key}`}
            className={cn(
              "rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-100",
              selectedFocus === key && "border-zinc-950 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800",
            )}
          >
            <div className="mb-4 flex items-center justify-between">
              <Icon className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
              <Badge variant={Number(metrics[key]) > 0 ? "amber" : "green"}>{Number(metrics[key]) > 0 ? "Review" : "Clear"}</Badge>
            </div>
            <div className="text-3xl font-semibold">{metrics[key]}</div>
            <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{label}</div>
          </Link>
        ))}
      </div>

      {selectedMetric ? (
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">{selectedMetric.label}</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Relevant records behind this Command Center metric.
              </p>
            </div>
            <Link href="/command-center" className="text-sm font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50">
              Clear selection
            </Link>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {focusItems.length === 0 ? (
              <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">{selectedMetric.empty}</div>
            ) : (
              focusItems.map((item) => (
                <Link key={`${item.kind}-${item.id}`} href={item.href} className="block p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">{item.title}</div>
                      <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{item.description}</div>
                      <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{item.meta}</div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {item.badges.map((badge) => (
                        <Badge key={badge} variant={badge.includes("Failed") || badge.includes("Urgent") ? "red" : "neutral"}>
                          {badge}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-semibold">Needs action now</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Conversations that are unread, unassigned, waiting on staff, failed, or carrying open follow-ups.
            </p>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {needsAction.length === 0 ? (
              <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">No urgent conversation actions.</div>
            ) : (
              needsAction.map((conversation) => (
                <Link key={conversation.id} href={`/inbox/${conversation.id}`} className="block p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">{conversation.customer.name}</div>
                      <div className="text-sm text-zinc-500 dark:text-zinc-400">
                        {labelize(conversation.department)} · {labelize(conversation.status)} · {conversation.assignedUser?.name ?? "Unassigned"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {conversation.unread ? <Badge variant="blue">Unread</Badge> : null}
                      {!conversation.assignedUserId ? <Badge variant="red">Unassigned</Badge> : null}
                      {conversation.messages.length > 0 ? <Badge variant="red">Failed SMS</Badge> : null}
                      {conversation.tasks.length > 0 ? <Badge variant="amber">Follow-up</Badge> : null}
                      {conversation.tags.map(({ tag }) => (
                        <Badge key={tag.id}>{tag.name}</Badge>
                      ))}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-semibold">Latest notifications</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Newest updates the GM should know about.</p>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {latestNotifications.length === 0 ? (
              <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">No active notifications.</div>
            ) : (
              latestNotifications.map((notification) => (
                <Link key={notification.id} href={notification.href} className="block p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{notification.title}</div>
                      <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        {notification.body ?? notification.conversation?.customer.name ?? notification.task?.customer.name}
                      </div>
                      <div className="mt-2 text-xs text-zinc-400">
                        {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                      </div>
                    </div>
                    <Badge variant={notification.priority === "URGENT" || notification.priority === "HIGH" ? "red" : "amber"}>
                      {labelize(notification.type)}
                    </Badge>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {canSeeDealershipRollup ? (
          <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-zinc-500" />
                <h2 className="font-semibold">Employee accountability</h2>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Assigned conversations</th>
                    <th className="px-4 py-3">Open follow-ups</th>
                    <th className="px-4 py-3">Overdue</th>
                    <th className="px-4 py-3">Failed SMS</th>
                    <th className="px-4 py-3">Active alerts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {employeeStats.map((employee) => (
                    <tr key={employee.id}>
                      <td className="px-4 py-3 font-medium">{employee.name}</td>
                      <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{labelize(employee.role)}</td>
                      <td className="px-4 py-3">{employee.assignedConversations}</td>
                      <td className="px-4 py-3">{employee.openFollowUps}</td>
                      <td className="px-4 py-3">
                        <Badge variant={employee.overdueFollowUps > 0 ? "red" : "green"}>{employee.overdueFollowUps}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={employee.failedMessages > 0 ? "red" : "green"}>{employee.failedMessages}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={employee.activeNotifications > 0 ? "amber" : "green"}>{employee.activeNotifications}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-semibold">Recent visible conversations</h2>
          </div>
          <div className="divide-y divide-zinc-100">
            {visibleConversations.map((conversation) => (
              <Link key={conversation.id} href={`/inbox/${conversation.id}`} className="block p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{conversation.customer.name}</div>
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      {labelize(conversation.department)} · {labelize(conversation.status)} · {conversation.assignedUser?.name ?? "Unassigned"}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {conversation.tags.map(({ tag }) => (
                      <Badge key={tag.id}>{tag.name}</Badge>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="font-semibold">Response health</h2>
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-3xl font-semibold">{responseHealth.averageResponseTime}</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">Average response time</div>
              <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                {responseHealth.definition} Based on {responseHealth.repliedInboundCount} replied inbound message
                {responseHealth.repliedInboundCount === 1 ? "" : "s"}.
              </div>
            </div>
            <div>
              <div className="text-3xl font-semibold">{metrics.messageVolume}</div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">Messages today</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
