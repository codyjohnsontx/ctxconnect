import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { updateTaskStatus } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
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

// A task is overdue only if it's still active and its due date has passed.
// The time read lives here (not in a component render) to keep the render pure.
function taskIsOverdue(task: TaskListItem) {
  return ACTIVE_STATUSES.includes(task.status) && task.dueDate.getTime() < Date.now();
}

function TaskCard({ task }: { task: TaskListItem }) {
  const isOverdue = taskIsOverdue(task);

  return (
    <div
      className={cn(
        "relative rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900",
        task.conversationId && "transition hover:bg-zinc-50 dark:hover:bg-zinc-800",
      )}
    >
      {task.conversationId ? (
        <Link href={`/inbox/${task.conversationId}?from=tasks`} className="absolute inset-0 rounded-lg">
          <span className="sr-only">Open conversation for {task.title} ({task.customer.name})</span>
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{task.title}</h2>
            <Badge variant={task.priority === "URGENT" || task.priority === "HIGH" ? "red" : "neutral"}>
              {labelize(task.priority)}
            </Badge>
            <Badge>{labelize(task.status)}</Badge>
            {isOverdue ? <Badge variant="red">Overdue</Badge> : null}
          </div>
          <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {task.customer.name} · {labelize(task.department)} ·{" "}
            <span className={isOverdue ? "font-medium text-red-600 dark:text-red-400" : undefined}>
              due {formatDistanceToNow(task.dueDate, { addSuffix: true })}
            </span>
          </div>
          {task.description ? <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{task.description}</p> : null}
        </div>
        <form action={updateTaskStatus} className="relative z-10 flex gap-2">
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
      </div>
    </div>
  );
}

const emptyStateClass =
  "rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function TasksPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;
  const tasks = await getTasks(user);

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
    <div className="p-5 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Follow-ups connected to customers and conversations.</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {tabs.map((tab) => {
          const active = tab.key === activeStatus;
          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
              )}
            >
              {tab.label}
              <span className={cn("text-xs", active ? "opacity-80" : "opacity-60")}>{tab.count}</span>
            </Link>
          );
        })}
      </div>

      {tasks.length === 0 ? (
        <div className={emptyStateClass}>No tasks yet.</div>
      ) : activeStatus ? (
        filtered.length === 0 ? (
          <div className={emptyStateClass}>No {labelize(activeStatus).toLowerCase()} tasks.</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )
      ) : (
        <div className="space-y-8">
          {STATUS_ORDER.filter((status) => countByStatus[status] > 0).map((status) => (
            <section key={status}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {labelize(status)} <span className="ml-1 opacity-70">{countByStatus[status]}</span>
              </h2>
              <div className="space-y-3">
                {(tasksByStatus.get(status) ?? []).map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
