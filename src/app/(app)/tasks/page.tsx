import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { updateTaskStatus } from "@/app/actions";
import { RescheduleFollowUp } from "@/components/reschedule-follow-up";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/section-header";
import { TaskStatus } from "@/generated/prisma/client";
import { getTasks } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { cn, labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

type TaskListItem = Awaited<ReturnType<typeof getTasks>>[number];

const STATUS_ORDER: TaskStatus[] = [
  TaskStatus.OPEN,
  TaskStatus.IN_PROGRESS,
  TaskStatus.DONE,
  TaskStatus.CANCELED,
];

const ACTIVE_STATUSES: TaskStatus[] = [TaskStatus.OPEN, TaskStatus.IN_PROGRESS];

// Read the clock once per request, outside any component render, so every task
// is compared against the same instant and the render functions stay pure.
function nowTimestamp() {
  return Date.now();
}

// A task is overdue only if it's still active and its due date has passed.
function taskIsOverdue(task: TaskListItem, now: number) {
  return ACTIVE_STATUSES.includes(task.status) && task.dueDate.getTime() < now;
}

function TaskCard({ task, now }: { task: TaskListItem; now: number }) {
  const isOverdue = taskIsOverdue(task, now);

  return (
    // The same card as the thread panel's follow-up: a hairline, the title with
    // its badges, one muted line, and the controls. Overdue says so in its own
    // words rather than tinting the whole card.
    <div
      className={cn(
        "relative rounded-md border border-border bg-surface p-3",
        task.conversationId && "transition-colors hover:bg-surface-raised",
      )}
    >
      {task.conversationId ? (
        <Link
          href={`/inbox/${task.conversationId}?from=tasks`}
          className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus-ring"
        >
          <span className="sr-only">Open conversation for {task.title} ({task.customer.name})</span>
        </Link>
      ) : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{task.title}</h2>
            <Badge variant={task.priority === "URGENT" || task.priority === "HIGH" ? "critical" : "neutral"}>
              {labelize(task.priority)}
            </Badge>
            <Badge>{labelize(task.status)}</Badge>
            {isOverdue ? <Badge variant="critical">Overdue</Badge> : null}
          </div>
          <div className="mt-1 text-200 text-text-muted">
            {task.customer.name} · {labelize(task.department)} ·{" "}
            <span className={isOverdue ? "font-medium text-critical" : undefined}>
              due {formatDistanceToNow(task.dueDate, { addSuffix: true })}
            </span>
          </div>
          {task.description ? <p className="mt-2 text-text-muted">{task.description}</p> : null}
        </div>
        <div className="relative z-10 flex flex-wrap items-center gap-2 md:justify-end">
          <form action={updateTaskStatus} className="flex gap-2">
            <input type="hidden" name="taskId" value={task.id} />
            <Select name="status" defaultValue={task.status} className="w-36">
              {Object.values(TaskStatus).map((status) => (
                <option key={status} value={status}>
                  {labelize(status)}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              Update
            </Button>
          </form>
          {/* Only while the follow-up is still live: a date on a finished one
              has nothing left to move. */}
          {ACTIVE_STATUSES.includes(task.status) ? (
            <RescheduleFollowUp taskId={task.id} dueAt={task.dueDate.toISOString()} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// The dashed card the mockup uses for a section with nothing in it.
const emptyStateClass = "rounded-md border border-dashed border-border bg-surface p-6 text-text-muted";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function TasksPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;
  const tasks = await getTasks(user);
  const now = nowTimestamp();

  const activeStatus = STATUS_ORDER.find((status) => status === params.status) ?? null;

  const tasksByStatus = new Map<TaskStatus, TaskListItem[]>(STATUS_ORDER.map((status) => [status, []]));
  for (const task of tasks) {
    tasksByStatus.get(task.status)?.push(task);
  }
  const countByStatus = Object.fromEntries(
    STATUS_ORDER.map((status) => [status, tasksByStatus.get(status)?.length ?? 0]),
  ) as Record<TaskStatus, number>;

  const tabs = [
    { key: null as TaskStatus | null, label: "All", count: tasks.length, href: "/tasks" },
    ...STATUS_ORDER.map((status) => ({
      key: status,
      label: labelize(status),
      count: countByStatus[status],
      href: `/tasks?status=${status}`,
    })),
  ];

  const filtered = activeStatus ? tasksByStatus.get(activeStatus) ?? [] : tasks;

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-600 font-semibold tracking-tight">Tasks</h1>

      {/* The status views are tabs on one rule: the active one carries the accent
          under it and its count rides along as a plain pill. On a phone the row
          scrolls sideways rather than wrapping onto a second rule. */}
      <nav aria-label="Filter by status" className="mb-4 flex gap-4 overflow-x-auto border-b border-border">
        {tabs.map((tab) => {
          const active = tab.key === activeStatus;
          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-1 font-medium transition-colors focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-focus-ring",
                active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text",
              )}
            >
              {tab.label}
              <Badge count>{tab.count}</Badge>
            </Link>
          );
        })}
      </nav>

      {tasks.length === 0 ? (
        <p className={emptyStateClass}>No tasks yet.</p>
      ) : activeStatus ? (
        filtered.length === 0 ? (
          <p className={emptyStateClass}>No {labelize(activeStatus).toLowerCase()} tasks.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((task) => (
              <TaskCard key={task.id} task={task} now={now} />
            ))}
          </div>
        )
      ) : (
        <div className="space-y-6">
          {STATUS_ORDER.filter((status) => countByStatus[status] > 0).map((status) => (
            <section key={status} className="space-y-2">
              <SectionHeader as="h2" title={labelize(status)} trailing={countByStatus[status]} />
              <div className="space-y-2">
                {(tasksByStatus.get(status) ?? []).map((task) => (
                  <TaskCard key={task.id} task={task} now={now} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
