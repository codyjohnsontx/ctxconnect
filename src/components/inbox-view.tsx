import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ArrowLeft, Circle, Clock3, MessageCircle, StickyNote } from "lucide-react";
import { addInternalNote, createTask, updateConversation } from "@/app/actions";
import { AiOpsBrief } from "@/components/ai-ops-brief";
import { MessageComposer } from "@/components/message-composer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  Priority,
} from "@/generated/prisma/client";
import type { getInboxData } from "@/lib/data";
import { cn, formatPhone, labelize } from "@/lib/utils";

type InboxData = Awaited<ReturnType<typeof getInboxData>>;

const departments = Object.values(Department);
const statuses = Object.values(ConversationStatus);
const priorities = Object.values(Priority);

const statusTone: Record<ConversationStatus, "neutral" | "green" | "amber" | "red" | "blue"> = {
  OPEN: "blue",
  WAITING_ON_CUSTOMER: "amber",
  WAITING_ON_STAFF: "red",
  FOLLOW_UP_NEEDED: "amber",
  CLOSED: "green",
};

type InboxViewProps = InboxData & {
  selectedId?: string;
  searchParams: Record<string, string | undefined>;
  isDemo?: boolean;
};

// Origins that a conversation can be opened from, with the label/href for the
// contextual back link. Navigating within the inbox list drops this origin.
const BACK_TARGETS: Record<string, { href: string; label: string }> = {
  tasks: { href: "/tasks", label: "Back to tasks" },
  customers: { href: "/customers", label: "Back to customers" },
};

function buildHref(conversationId: string, searchParams: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    // Drop the origin marker: clicking a sibling thread in the list means the
    // user is navigating within the inbox, not still coming from tasks/customers.
    if (value && key !== "from") {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return `/inbox/${conversationId}${query ? `?${query}` : ""}`;
}

export function InboxView({
  conversations,
  selectedConversation,
  users,
  tags,
  templates,
  dealershipSettings,
  searchParams,
  isDemo,
}: InboxViewProps) {
  const selectedVehicle = selectedConversation?.customer.vehicles[0];
  const unit = selectedVehicle
    ? `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`
    : "unit";
  const advisorName = selectedConversation?.assignedUser?.name ?? "the team";
  const backTarget = searchParams.from ? BACK_TARGETS[searchParams.from] ?? null : null;

  return (
    <div className="grid h-dvh min-h-0 grid-rows-[auto_1fr] lg:grid-cols-[390px_minmax(0,1fr)] lg:grid-rows-1">
      <section className={cn("min-h-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950", selectedConversation && "hidden lg:block")}>
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{conversations.length} visible conversations</p>
            </div>
            <Badge variant="blue">Shared</Badge>
          </div>
          <form className="grid grid-cols-2 gap-2" action="/inbox">
            <Select name="department" defaultValue={searchParams.department ?? ""} aria-label="Department filter">
              <option value="">All departments</option>
              {departments.map((department) => (
                <option key={department} value={department}>
                  {labelize(department)}
                </option>
              ))}
            </Select>
            <Select name="status" defaultValue={searchParams.status ?? ""} aria-label="Status filter">
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {labelize(status)}
                </option>
              ))}
            </Select>
            <Select name="assigned" defaultValue={searchParams.assigned ?? ""} aria-label="Assignee filter">
              <option value="">Anyone</option>
              <option value="unassigned">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
            <Select name="tag" defaultValue={searchParams.tag ?? ""} aria-label="Tag filter">
              <option value="">Any tag</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
            <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
              <input name="unread" value="true" type="checkbox" defaultChecked={searchParams.unread === "true"} />
              Unread
            </label>
            <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
              <input name="failed" value="true" type="checkbox" defaultChecked={searchParams.failed === "true"} />
              Failed
            </label>
            <label className="flex h-10 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
              <input name="needsAction" value="true" type="checkbox" defaultChecked={searchParams.needsAction === "true"} />
              Needs action
            </label>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
        </div>

        <div className="h-[calc(100dvh-220px)] overflow-y-auto lg:h-[calc(100dvh)] lg:pt-[221px] lg:-mt-[221px]">
          {conversations.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">No conversations match these filters.</div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {conversations.map((conversation) => {
                const lastMessage = conversation.messages[0];
                const hasOpenTask = conversation.tasks.length > 0;
                const selected = selectedConversation?.id === conversation.id;

                return (
                  <Link
                    key={conversation.id}
                    href={buildHref(conversation.id, searchParams)}
                    className={cn(
                      "block p-4 transition hover:bg-zinc-50 dark:hover:bg-zinc-900",
                      selected && "bg-zinc-100 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-900",
                    )}
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {conversation.unread ? <Circle className="h-2.5 w-2.5 fill-blue-600 text-blue-600" /> : null}
                          <p className="truncate text-sm font-semibold">{conversation.customer.name}</p>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{formatPhone(conversation.customer.phone)}</p>
                      </div>
                      <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                        {formatDistanceToNow(conversation.lastMessageAt, { addSuffix: true })}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
                      {lastMessage?.body ?? conversation.subject ?? "No messages yet"}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Badge>{labelize(conversation.department)}</Badge>
                      <Badge variant={statusTone[conversation.status]}>{labelize(conversation.status)}</Badge>
                      {conversation.priority === Priority.HIGH || conversation.priority === Priority.URGENT ? (
                        <Badge variant="red">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          {labelize(conversation.priority)}
                        </Badge>
                      ) : null}
                      {hasOpenTask ? (
                        <Badge variant="amber">
                          <Clock3 className="mr-1 h-3 w-3" />
                          Follow-up
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {conversation.tags.map(({ tag }) => (
                        <span key={tag.id} className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: `${tag.color}18`, color: tag.color }}>
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {selectedConversation ? (
        <section className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-h-0 flex-col">
            <header className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="min-w-0">
                {backTarget ? (
                  <Link
                    href={backTarget.href}
                    className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    {backTarget.label}
                  </Link>
                ) : (
                  // On mobile the conversation list is hidden when a thread is open,
                  // so give an inbox-origin conversation a way back to the list.
                  <Link
                    href="/inbox"
                    className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition hover:text-zinc-900 lg:hidden dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to inbox
                  </Link>
                )}
                <h2 className="truncate text-lg font-semibold">{selectedConversation.customer.name}</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {selectedConversation.subject ?? labelize(selectedConversation.department)} · {formatPhone(selectedConversation.customer.phone)}
                </p>
              </div>
              <Badge variant={selectedConversation.customer.smsOptedOut ? "red" : "green"}>
                {selectedConversation.customer.smsOptedOut ? "SMS opted out" : "SMS ok"}
              </Badge>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto bg-zinc-50 p-5 dark:bg-zinc-950">
              {selectedConversation.messages.map((message) => {
                const internal = message.direction === MessageDirection.INTERNAL;
                const outbound = message.direction === MessageDirection.OUTBOUND;

                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      outbound ? "justify-end" : "justify-start",
                      internal && "justify-center",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[78%] rounded-lg px-4 py-3 text-sm shadow-sm",
                        outbound && "bg-zinc-950 text-white",
                        message.direction === MessageDirection.INBOUND && "bg-white text-zinc-900 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800",
                        internal && "max-w-[88%] bg-amber-50 text-amber-950 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-900",
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
                        {internal ? <StickyNote className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
                        <span>
                          {internal
                            ? `Internal note by ${message.sender?.name ?? "staff"}`
                            : outbound
                              ? message.sender?.name ?? "Staff"
                              : selectedConversation.customer.name}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap leading-6">{message.body}</p>
                      <div className="mt-2 text-[11px] opacity-60">
                        {formatDistanceToNow(message.createdAt, { addSuffix: true })} · {labelize(message.deliveryStatus)}
                        {message.deliveryStatus === DeliveryStatus.FAILED && message.errorMessage ? ` · ${message.errorMessage}` : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <MessageComposer
              conversationId={selectedConversation.id}
              customerName={selectedConversation.customer.name}
              advisorName={advisorName}
              dealershipName={dealershipSettings.dealershipName}
              unit={unit}
              department={selectedConversation.department}
              templates={templates}
              disabled={selectedConversation.customer.smsOptedOut}
              demoBlocked={isDemo}
            />
          </div>

          <aside className="hidden min-h-0 overflow-y-auto border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:block">
            <div className="space-y-6 p-5">
              <AiOpsBrief
                key={selectedConversation.id}
                conversationId={selectedConversation.id}
                initialInsight={selectedConversation.aiInsights[0] ?? null}
              />

              <section>
                <h3 className="mb-3 text-sm font-semibold">Conversation controls</h3>
                <form action={updateConversation} className="space-y-3">
                  <input type="hidden" name="conversationId" value={selectedConversation.id} />
                  <div className="space-y-1.5">
                    <Label>Assignee</Label>
                    <Select name="assignedUserId" defaultValue={selectedConversation.assignedUserId ?? "unassigned"}>
                      <option value="unassigned">Unassigned</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select name="status" defaultValue={selectedConversation.status}>
                        {statuses.map((status) => (
                          <option key={status} value={status}>
                            {labelize(status)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Priority</Label>
                      <Select name="priority" defaultValue={selectedConversation.priority}>
                        {priorities.map((priority) => (
                          <option key={priority} value={priority}>
                            {labelize(priority)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Department</Label>
                    <Select name="department" defaultValue={selectedConversation.department}>
                      {departments.map((department) => (
                        <option key={department} value={department}>
                          {labelize(department)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button type="submit" variant="secondary" className="w-full">
                    Save controls
                  </Button>
                </form>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold">Customer profile</h3>
                <div className="space-y-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                  <div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Phone</div>
                    <div>{formatPhone(selectedConversation.customer.phone)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Email</div>
                    <div>{selectedConversation.customer.email ?? "No email"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Preferred contact</div>
                    <div>{labelize(selectedConversation.customer.preferredContactMethod)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">SMS consent</div>
                    <div>{selectedConversation.customer.smsOptedOut ? "Opted out via STOP" : "Eligible to receive SMS"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">Notes</div>
                    <div className="leading-5 text-zinc-700 dark:text-zinc-300">{selectedConversation.customer.notes ?? "No notes yet."}</div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold">Units</h3>
                <div className="space-y-2">
                  {selectedConversation.customer.vehicles.map((vehicle) => (
                    <div key={vehicle.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                      <div className="font-medium">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {labelize(vehicle.relationship)} · VIN {vehicle.vin ?? "n/a"}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        Stock {vehicle.stockNumber ?? "n/a"} · {vehicle.mileage?.toLocaleString() ?? 0} mi
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold">Open follow-ups</h3>
                <div className="space-y-2">
                  {selectedConversation.tasks.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-zinc-200 p-3 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">No open follow-ups.</p>
                  ) : (
                    selectedConversation.tasks.map((task) => (
                      <div key={task.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                        <div className="font-medium">{task.title}</div>
                        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Due {formatDistanceToNow(task.dueDate, { addSuffix: true })} · {task.assignedUser?.name ?? "Unassigned"}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold">Add internal note</h3>
                <form action={addInternalNote} className="space-y-2">
                  <input type="hidden" name="conversationId" value={selectedConversation.id} />
                  <input type="hidden" name="aiInsightId" data-ai-note-insight />
                  <Textarea name="body" placeholder="Visible only to staff..." />
                  <Button type="submit" variant="secondary" className="w-full">
                    Save note
                  </Button>
                </form>
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold">Create follow-up</h3>
                <form action={createTask} className="space-y-2">
                  <input type="hidden" name="customerId" value={selectedConversation.customerId} />
                  <input type="hidden" name="conversationId" value={selectedConversation.id} />
                  <input type="hidden" name="aiInsightId" data-ai-follow-up-insight />
                  <Input name="title" placeholder="Task title" required />
                  <Textarea name="description" placeholder="Optional details" className="min-h-16" />
                  <Select name="assignedUserId" defaultValue={selectedConversation.assignedUserId ?? "unassigned"}>
                    <option value="unassigned">Unassigned</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <Select name="department" defaultValue={selectedConversation.department}>
                      {departments.map((department) => (
                        <option key={department} value={department}>
                          {labelize(department)}
                        </option>
                      ))}
                    </Select>
                    <Select name="priority" defaultValue={selectedConversation.priority}>
                      {priorities.map((priority) => (
                        <option key={priority} value={priority}>
                          {labelize(priority)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Input name="dueDate" type="datetime-local" required />
                  <Button type="submit" variant="secondary" className="w-full">
                    Add follow-up
                  </Button>
                </form>
              </section>
            </div>
          </aside>
        </section>
      ) : (
        <section className="hidden min-h-0 items-center justify-center bg-zinc-50 p-8 dark:bg-zinc-950 lg:flex">
          <div className="max-w-sm text-center">
            <MessageCircle className="mx-auto mb-4 h-10 w-10 text-zinc-400 dark:text-zinc-600" />
            <h2 className="text-lg font-semibold">Select a conversation</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Open a customer thread to view messages, profile context, templates, and follow-ups.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
