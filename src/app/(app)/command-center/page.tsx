import type { ReactNode } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Bell,
  Bike,
  BrainCircuit,
  Clock3,
  Inbox,
  MessageSquare,
  Send,
  UserX,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { LocalTimestamp } from "@/components/local-timestamp";
import { getCommandCenterData } from "@/lib/data";
import { isManagerOrAdmin } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
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

// Every block on the page is one bordered card: a header with one rule under
// it, then rows that share a hairline, or a stat or two.
const cardClass = "rounded-md border border-border bg-surface";
const cardHeaderClass = "border-b border-border px-4 py-2";
const rowClass =
  "block px-4 py-3 transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-inset";
const emptyRowClass = "px-4 py-3 text-text-muted";
// The one link style for leaving a selection behind, as the inbox spells it.
const linkClass = "text-200 font-medium text-accent underline-offset-2 hover:underline";

/** A number with its label under it; the figure is the thing, the label says what it counts. */
function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div>
      <div className="text-600 font-semibold tabular-nums">{value}</div>
      <div className="text-200 text-text-muted">{label}</div>
    </div>
  );
}

type PageProps = {
  searchParams: Promise<{ focus?: string }>;
};

export default async function CommandCenterPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const { focus } = await searchParams;
  const {
    metrics,
    responseHealth,
    visibleConversations,
    latestNotifications,
    notificationCount,
    selectedFocus,
    focusItems,
    needsAction,
    employeeStats,
    aiOpsAnalytics,
  } =
    await getCommandCenterData(user, focus);
  const selectedMetric = metricConfig.find((metric) => metric.key === selectedFocus);
  const canSeeDealershipRollup = isManagerOrAdmin(user);

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Whose numbers these are sits beside the title rather than under it:
          a manager reads the dealership, an advisor reads her own scope. */}
      <div className="flex items-center gap-2">
        <h1 className="text-600 font-semibold tracking-tight">Command Center</h1>
        <Badge variant={canSeeDealershipRollup ? "info" : "neutral"}>
          {canSeeDealershipRollup ? "Dealership" : "Your scope"}
        </Badge>
      </div>

      {/* Two across even on a phone: ten tiles one under the other push every
          list below the fold. */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {metricConfig.map(({ key, label, icon: Icon }) => {
          const count = Number(metrics[key]);
          const selected = selectedFocus === key;
          return (
            // The selected tile takes the accent the same way a selected queue
            // row does; the badge is the status, and the number is the rest.
            <Link
              key={key}
              href={`/command-center?focus=${key}`}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "rounded-md border border-border bg-surface p-3 transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring",
                selected && "border-accent bg-accent-surface hover:bg-accent-surface",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Icon className={cn("size-4", selected ? "text-accent" : "text-text-muted")} aria-hidden="true" />
                <Badge variant={count > 0 ? "warning" : "success"}>{count > 0 ? "Review" : "Clear"}</Badge>
              </div>
              <div className="mt-2 text-700 font-semibold tabular-nums">{metrics[key]}</div>
              <div className="text-200 text-text-muted">{label}</div>
            </Link>
          );
        })}
      </div>

      {selectedMetric ? (
        <section className={cardClass}>
          <div className={cardHeaderClass}>
            <SectionHeader
              title={selectedMetric.label}
              trailing={
                <Link href="/command-center" className={linkClass}>
                  Clear selection
                </Link>
              }
            />
          </div>
          <div className="divide-y divide-border">
            {focusItems.length === 0 ? (
              <p className={emptyRowClass}>{selectedMetric.empty}</p>
            ) : (
              focusItems.map((item) => (
                <Link key={`${item.kind}-${item.id}`} href={item.href} className={rowClass}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium">{item.title}</div>
                      <div className="text-text-muted">{item.description}</div>
                      <div className="text-200 text-text-faint">
                        {item.meta}
                        {item.kind === "task" ? (
                          <>
                            {" · due "}
                            <LocalTimestamp value={item.dueAt} />
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 sm:justify-end">
                      {item.badges.map((badge) => (
                        <Badge key={badge} variant={badge.includes("Failed") || badge.includes("Urgent") ? "critical" : "neutral"}>
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

      <section className={cardClass}>
        <div className={cardHeaderClass}>
          {/* The AI speaks in the info tone everywhere, so its icon does here. */}
          <SectionHeader
            title={
              <>
                <BrainCircuit className="size-4 text-info" aria-hidden="true" />
                AI Ops Analytics
              </>
            }
            trailing="Last 14 days"
          />
        </div>
        <div className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat value={aiOpsAnalytics.generatedCount} label="Briefs generated" />
          <Stat
            value={aiOpsAnalytics.acceptanceRate === null ? "n/a" : `${aiOpsAnalytics.acceptanceRate}%`}
            label="Acceptance rate"
          />
          <Stat value={aiOpsAnalytics.highRiskInsightCount} label="High-risk briefs" />
          <Stat
            value={aiOpsAnalytics.followUpCreatedCount + aiOpsAnalytics.noteCreatedCount}
            label="Follow-ups / notes used"
          />
        </div>
        <div className="divide-y divide-border">
          {aiOpsAnalytics.latestHighRiskInsights.length === 0 ? (
            <p className={emptyRowClass}>No high-risk AI briefs in this window.</p>
          ) : (
            aiOpsAnalytics.latestHighRiskInsights.map((insight) => (
              <Link key={insight.id} href={`/inbox/${insight.conversationId}`} className={rowClass}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium">{insight.customerName}</div>
                    <div className="text-text-muted">{insight.summary}</div>
                    <div className="mt-1 text-200 text-text-faint">
                      {insight.suggestedNextAction} · {formatDistanceToNow(insight.createdAt, { addSuffix: true })}
                    </div>
                  </div>
                  <Badge variant={insight.riskLevel === "URGENT" ? "critical" : "warning"}>{labelize(insight.riskLevel)}</Badge>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>

      {/* Side by side from xl up, each card its own height: a short list
          stretched to its neighbour's is a card that is mostly empty. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] xl:items-start">
        <section className={cardClass}>
          <div className={cardHeaderClass}>
            <SectionHeader title="Needs action now" />
          </div>
          <div className="divide-y divide-border">
            {needsAction.length === 0 ? (
              <p className={emptyRowClass}>No urgent conversation actions.</p>
            ) : (
              needsAction.map((conversation) => (
                <Link key={conversation.id} href={`/inbox/${conversation.id}`} className={rowClass}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium">{conversation.customer.name}</div>
                      <div className="text-200 text-text-muted">
                        {labelize(conversation.department)} · {labelize(conversation.status)} · {conversation.assignedUser?.name ?? "Unassigned"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 sm:justify-end">
                      {conversation.unread ? <Badge variant="info">Unread</Badge> : null}
                      {!conversation.assignedUserId ? <Badge variant="critical">Unassigned</Badge> : null}
                      {conversation.messages.length > 0 ? <Badge variant="critical">Failed SMS</Badge> : null}
                      {conversation.tasks.length > 0 ? <Badge variant="warning">Follow-up</Badge> : null}
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

        <section id="alerts" className={cn("scroll-mt-6", cardClass)}>
          <div className={cardHeaderClass}>
            <SectionHeader
              title="Alerts"
              trailing={
                <Badge count variant={notificationCount > 0 ? "warning" : "success"}>
                  {notificationCount}
                </Badge>
              }
            />
          </div>
          <div className="divide-y divide-border">
            {latestNotifications.length === 0 ? (
              <p className={emptyRowClass}>No active notifications.</p>
            ) : (
              latestNotifications.map((notification) => (
                <Link key={notification.id} href={notification.href} className={rowClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{notification.title}</div>
                      <div className="text-text-muted">
                        {notification.body ?? notification.conversation?.customer.name ?? notification.task?.customer.name}
                      </div>
                      <div className="mt-1 text-200 text-text-faint">
                        {formatDistanceToNow(notification.createdAt, { addSuffix: true })}
                      </div>
                    </div>
                    <Badge variant={notification.priority === "URGENT" || notification.priority === "HIGH" ? "critical" : "warning"}>
                      {labelize(notification.type)}
                    </Badge>
                  </div>
                </Link>
              ))
            )}
            {/* The list is capped; when the badge promises more than it shows,
                the difference is said in the body rather than under the title. */}
            {notificationCount > latestNotifications.length ? (
              <p className="px-4 py-2 text-200 text-text-muted">
                The {latestNotifications.length} most urgent of {notificationCount} in your scope.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {/* min-w-0 on the stack, or the table's minimum width opens the single
          column up and the whole page scrolls sideways on a phone. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_var(--layout-panel-width)] xl:items-start">
        <div className="min-w-0 space-y-4">
        {canSeeDealershipRollup ? (
          <section className={cardClass}>
            <div className={cardHeaderClass}>
              <SectionHeader
                title={
                  <>
                    <Users className="size-4 text-text-muted" aria-hidden="true" />
                    Employee accountability
                  </>
                }
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead className="border-b border-border text-200 text-text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Employee</th>
                    <th className="px-4 py-2 font-medium">Role</th>
                    <th className="px-4 py-2 font-medium">Assigned conversations</th>
                    <th className="px-4 py-2 font-medium">Open follow-ups</th>
                    <th className="px-4 py-2 font-medium">Overdue</th>
                    <th className="px-4 py-2 font-medium">Failed SMS</th>
                    <th className="px-4 py-2 font-medium">Active alerts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {employeeStats.map((employee) => (
                    <tr key={employee.id}>
                      <td className="px-4 py-2 font-medium">{employee.name}</td>
                      <td className="px-4 py-2 text-text-muted">{labelize(employee.role)}</td>
                      <td className="px-4 py-2 tabular-nums">{employee.assignedConversations}</td>
                      <td className="px-4 py-2 tabular-nums">{employee.openFollowUps}</td>
                      <td className="px-4 py-2">
                        <Badge count variant={employee.overdueFollowUps > 0 ? "critical" : "success"}>
                          {employee.overdueFollowUps}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge count variant={employee.failedMessages > 0 ? "critical" : "success"}>
                          {employee.failedMessages}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge count variant={employee.activeNotifications > 0 ? "warning" : "success"}>
                          {employee.activeNotifications}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className={cardClass}>
          <div className={cardHeaderClass}>
            <SectionHeader title="Response health" />
          </div>
          <div className="space-y-3 px-4 py-3">
            <div>
              <Stat value={responseHealth.averageResponseTime} label="Average response time" />
              <p className="mt-1 text-200 text-text-faint">
                {responseHealth.definition} Based on {responseHealth.repliedInboundCount} replied inbound message
                {responseHealth.repliedInboundCount === 1 ? "" : "s"}.
              </p>
            </div>
            <Stat value={metrics.messageVolume} label="Messages today" />
          </div>
        </section>
        </div>

        {/* A panel-width column, so its rows stack name, line and tags the
            way the queue does rather than squeezing tags beside the name. */}
        <section className={cardClass}>
          <div className={cardHeaderClass}>
            <SectionHeader title="Recent visible conversations" />
          </div>
          <div className="divide-y divide-border">
            {visibleConversations.map((conversation) => (
              <Link key={conversation.id} href={`/inbox/${conversation.id}`} className={rowClass}>
                <div className="font-medium">{conversation.customer.name}</div>
                <div className="text-200 text-text-muted">
                  {labelize(conversation.department)} · {labelize(conversation.status)} · {conversation.assignedUser?.name ?? "Unassigned"}
                </div>
                {conversation.tags.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {conversation.tags.map(({ tag }) => (
                      <Badge key={tag.id}>{tag.name}</Badge>
                    ))}
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
