import { formatDistanceToNow } from "date-fns";
import { updateTaskStatus } from "@/app/actions";
import { getServerSession } from "next-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { TaskStatus } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import { getTasks } from "@/lib/data";
import { labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const session = await getServerSession(authOptions);
  const tasks = await getTasks(session!.user);

  return (
    <div className="p-5 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Follow-ups connected to customers and conversations.</p>
      </div>
      <div className="space-y-3">
        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">No tasks yet.</div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{task.title}</h2>
                    <Badge variant={task.priority === "URGENT" || task.priority === "HIGH" ? "red" : "neutral"}>
                      {labelize(task.priority)}
                    </Badge>
                    <Badge>{labelize(task.status)}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {task.customer.name} · {labelize(task.department)} · due {formatDistanceToNow(task.dueDate, { addSuffix: true })}
                  </div>
                  {task.description ? <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{task.description}</p> : null}
                </div>
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
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
