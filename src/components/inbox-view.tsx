import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ArrowLeft, ArrowRightLeft, Circle, Clock3, MessageCircle, Sparkles, StickyNote } from "lucide-react";
import { addInternalNote, createTask } from "@/app/actions";
import { AiOpsBrief } from "@/components/ai-ops-brief";
import { ConversationControls } from "@/components/conversation-controls";
import { MessageComposer } from "@/components/message-composer";
import { QueueStatus } from "@/components/queue-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { ConversationStatus, Department, MessageDirection, Priority } from "@/generated/prisma/client";
import { hasCurrentBrief } from "@/lib/ai/ambient-pass";
import { handOffReasons } from "@/lib/conversation-controls-state";
import type { AppUser, getInboxData } from "@/lib/data";
import { defaultFollowUpDueDate } from "@/lib/follow-ups";
import {
  UNDELIVERED_HEADLINE,
  isUndelivered,
  lastUndeliveredOutbound,
  undeliveredDetail,
} from "@/lib/message-delivery";
import { type PreviewAuthor, previewAttribution } from "@/lib/message-preview";
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

// A previewed message that is not the customer's gets a label in the voice's
// own colour: amber for a note, matching the amber note bubble in the thread,
// and plain zinc for a staff reply, which is ordinary rather than notable.
const authorTone: Record<PreviewAuthor, string> = {
  staff: "text-zinc-500 dark:text-zinc-400",
  note: "text-amber-700 dark:text-amber-400",
};

const aiRiskTone: Record<Priority, "neutral" | "green" | "amber" | "red" | "blue"> = {
  LOW: "green",
  NORMAL: "blue",
  HIGH: "amber",
  URGENT: "red",
};

type InboxViewProps = InboxData & {
  selectedId?: string;
  searchParams: Record<string, string | undefined>;
  isDemo?: boolean;
  currentUser: AppUser;
};

// Origins that a conversation can be opened from, with the label/href for the
// contextual back link. Navigating within the inbox list drops this origin.
const BACK_TARGETS: Record<string, { href: string; label: string }> = {
  tasks: { href: "/tasks", label: "Back to tasks" },
  customers: { href: "/customers", label: "Back to customers" },
};

// Query keys that describe one navigation or one save rather than a filter, so
// a link to another thread has to leave them behind: `from` because clicking a
// sibling thread in the list means she is navigating within the inbox and not
// still coming from tasks/customers, and the hand-off pair because they describe
// the save she just made and would otherwise re-assert that notice on every
// thread she opens afterwards.
const ONE_SAVE_PARAMS = new Set(["from", "movedTo", "handOff"]);

function buildHref(conversationId: string, searchParams: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value && !ONE_SAVE_PARAMS.has(key)) {
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
  queueStatus,
  searchParams,
  isDemo,
  currentUser,
}: InboxViewProps) {
  const selectedVehicle = selectedConversation?.customer.vehicles[0];
  // null rather than a stand-in word: a template that names the bike should ask
  // for it, not text the customer about "your unit".
  const unit = selectedVehicle
    ? `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`
    : null;
  const advisorName = selectedConversation?.assignedUser?.name ?? "the team";
  const selectedBriefIsCurrent = selectedConversation ? hasCurrentBrief(selectedConversation) : true;
  const backTarget = searchParams.from ? BACK_TARGETS[searchParams.from] ?? null : null;
  // Validated against the enum rather than printed: it arrives on the URL, and
  // the banner should never render whatever a hand-typed query string says. The
  // reason is checked the same way, and an unrecognised one reads as the
  // department move the named department already points at.
  const movedTo = departments.find((department) => department === searchParams.movedTo) ?? null;
  const movedWhy = handOffReasons.find((reason) => reason === searchParams.handOff) ?? "department";
  // Formatted here rather than in the brief panel so the duplicate warning and
  // the "Open follow-ups" list below it read the same due date the same way.
  const openFollowUps = (selectedConversation?.tasks ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    dueLabel: formatDistanceToNow(task.dueDate, { addSuffix: true }),
  }));
  const defaultDueDate = defaultFollowUpDueDate(new Date());

  return (
    <div className="grid h-dvh min-h-0 grid-rows-[minmax(0,1fr)] lg:grid-cols-[390px_minmax(0,1fr)] lg:grid-rows-1">
      <section className={cn("min-h-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950", selectedConversation ? "hidden lg:flex" : "flex")}>
        <div className="relative z-10 shrink-0 border-b border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {conversations.length} conversations, ranked by what the AI flagged
              </p>
            </div>
            <Badge variant="blue">Shared</Badge>
          </div>
          {/* Set by a save that moved a thread out of this advisor's reach.
              Without it the save silently swaps her open conversation for a bare
              404, which reads like the app lost her place. It says which of the
              two things happened for the same reason the panel's warning does:
              an assignment can carry the thread off without the department
              moving anywhere. */}
          {movedTo ? (
            <p className="mb-3 flex items-start gap-1.5 rounded-md bg-blue-50 p-2 text-xs leading-5 text-blue-900 dark:bg-blue-950 dark:text-blue-100">
              <ArrowRightLeft className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                {movedWhy === "department"
                  ? `Handed off to ${labelize(movedTo)}. That conversation has left your inbox.`
                  : "That conversation was taken off you. It has left your inbox."}
              </span>
            </p>
          ) : null}
          <QueueStatus status={queueStatus} />
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

        <div className="min-h-0 flex-1 overflow-y-auto pb-20 lg:pb-0">
          {conversations.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">No conversations match these filters.</div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {conversations.map((conversation) => {
                const lastMessage = conversation.messages[0];
                // The preview is whatever was written last, which includes a reply
                // that never reached the customer. Left unmarked it reads as an
                // answer already given, and the row is where she decides to skip.
                const previewUndelivered = lastMessage ? isUndelivered(lastMessage) : false;
                // Whose words the preview is. An inbound message gets nothing:
                // the customer's voice is what a row is read as by default, and
                // her name is already in bold on the line above. Skipped when the
                // reply failed - "Not delivered:" is both the more urgent fact and
                // already proof that staff wrote it, and two labels on one row
                // would fight for a two-line clamp.
                const previewAuthor = previewUndelivered
                  ? null
                  : previewAttribution(lastMessage, currentUser.id);
                const hasOpenTask = conversation.tasks.length > 0;
                const selected = selectedConversation?.id === conversation.id;
                const insight = conversation.aiInsights[0];
                // The freshness rule the header counter uses, read from the one
                // place that defines it. A row that presented a brief older than
                // the thread's newest message as the current read would contradict
                // the counter that already excluded it.
                const briefIsCurrent = hasCurrentBrief(conversation);

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
                    <p className="line-clamp-2 break-words text-sm text-zinc-600 dark:text-zinc-300">
                      {previewUndelivered ? (
                        // The space is a real text node rather than a margin so the
                        // label and the message do not run together when the row is
                        // read aloud or copied.
                        <span className="font-semibold text-red-600 dark:text-red-400">Not delivered: </span>
                      ) : null}
                      {previewAuthor ? (
                        <span className={cn("font-semibold", authorTone[previewAuthor.author])}>
                          {previewAuthor.label}{" "}
                        </span>
                      ) : null}
                      {lastMessage?.body ?? conversation.subject ?? "No messages yet"}
                    </p>
                    {insight && !insight.dismissedAt ? (
                      <div className="mt-2 flex items-start gap-1.5 rounded-md bg-blue-50 p-2 text-xs leading-5 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100">
                        <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="line-clamp-2">
                          {briefIsCurrent
                            ? insight.suggestedNextAction
                            : `Earlier brief: ${insight.suggestedNextAction}`}
                        </span>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {insight ? (
                        insight.dismissedAt ? (
                          <Badge>Dismissed</Badge>
                        ) : (
                          <Badge variant={briefIsCurrent ? aiRiskTone[insight.riskLevel] : "neutral"}>
                            <Sparkles className="mr-1 h-3 w-3" />
                            {briefIsCurrent
                              ? labelize(insight.riskLevel)
                              : `${labelize(insight.riskLevel)} · earlier brief`}
                          </Badge>
                        )
                      ) : (
                        <Badge>Not briefed</Badge>
                      )}
                      {insight?.escalationRecommended && !insight.dismissedAt ? (
                        <Badge variant={briefIsCurrent ? "red" : "neutral"}>
                          {briefIsCurrent ? "Escalate" : "Escalate · earlier brief"}
                        </Badge>
                      ) : null}
                      <Badge>{labelize(conversation.department)}</Badge>
                      <Badge variant={statusTone[conversation.status]}>{labelize(conversation.status)}</Badge>
                      {/* The staff-set priority is only worth a badge where the AI is not
                          currently rating the thread; otherwise the two say the same word
                          twice. A dismissed brief counts as not rating it: dismissing the
                          AI's opinion must not erase the human's. */}
                      {(!insight || insight.dismissedAt) &&
                      (conversation.priority === Priority.HIGH || conversation.priority === Priority.URGENT) ? (
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
        <section className="flex min-h-0 flex-col overflow-y-auto pb-20 lg:grid lg:pb-0 lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
          <div className="flex min-h-0 shrink-0 flex-col">
            <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4 lg:static dark:border-zinc-800 dark:bg-zinc-950">
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

            <div className="max-h-[34dvh] flex-none space-y-4 overflow-y-auto bg-zinc-50 p-5 lg:max-h-none lg:flex-1 dark:bg-zinc-950">
              {selectedConversation.messages.map((message) => {
                const internal = message.direction === MessageDirection.INTERNAL;
                const outbound = message.direction === MessageDirection.OUTBOUND;
                const undelivered = isUndelivered(message);
                const undeliveredCause = undelivered ? undeliveredDetail(message.errorMessage) : null;

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
                        // An undelivered reply keeps the sent bubble's shape and side,
                        // because that is where she wrote it, but loses the delivered
                        // bubble's colour so the two can never be skimmed as the same
                        // thing.
                        undelivered &&
                          "bg-red-50 text-red-950 ring-1 ring-red-300 dark:bg-red-950/60 dark:text-red-50 dark:ring-red-800",
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
                      {/* break-words because a customer sending a photo link is
                          ordinary, and one unbroken word is wider than the bubble:
                          the URL ran off the right and the middle of it could not
                          be read at all. */}
                      <p className="whitespace-pre-wrap break-words leading-6">{message.body}</p>
                      {undelivered ? (
                        <div className="mt-2 flex items-start gap-1.5 text-xs font-semibold leading-5">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            {UNDELIVERED_HEADLINE}
                            {undeliveredCause ? (
                              <span className="block font-normal opacity-80">{undeliveredCause}</span>
                            ) : null}
                          </span>
                        </div>
                      ) : null}
                      <div className="mt-2 text-[11px] opacity-60">
                        {formatDistanceToNow(message.createdAt, { addSuffix: true })} · {labelize(message.deliveryStatus)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <MessageComposer
              key={selectedConversation.id}
              conversationId={selectedConversation.id}
              userId={currentUser.id}
              customerName={selectedConversation.customer.name}
              advisorName={advisorName}
              dealershipName={dealershipSettings.dealershipName}
              unit={unit}
              department={selectedConversation.department}
              templates={templates}
              disabled={selectedConversation.customer.smsOptedOut}
              demoBlocked={isDemo}
              unsentBody={lastUndeliveredOutbound(selectedConversation.messages)?.body ?? null}
            />
          </div>

          <aside className="min-h-0 shrink-0 border-t border-zinc-200 bg-white lg:overflow-y-auto lg:border-l lg:border-t-0 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="space-y-6 p-5">
              <AiOpsBrief
                key={selectedConversation.id}
                conversationId={selectedConversation.id}
                initialInsight={selectedConversation.aiInsights[0] ?? null}
                openFollowUps={openFollowUps}
                briefIsCurrent={selectedBriefIsCurrent}
              />

              <section>
                <h3 className="mb-3 text-sm font-semibold">Conversation controls</h3>
                <ConversationControls
                  key={selectedConversation.id}
                  conversationId={selectedConversation.id}
                  users={users}
                  saved={{
                    assignedUserId: selectedConversation.assignedUserId ?? "unassigned",
                    status: selectedConversation.status,
                    priority: selectedConversation.priority,
                    department: selectedConversation.department,
                  }}
                  currentUser={currentUser}
                />
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
                      // The brief's "See the follow-up" lands here, so the card
                      // needs an anchor and room to clear the sticky header.
                      <div
                        key={task.id}
                        id={`follow-up-${task.id}`}
                        className="scroll-mt-6 rounded-lg border border-zinc-200 p-3 text-sm target:border-amber-400 target:bg-amber-50 dark:border-zinc-800 dark:target:border-amber-600 dark:target:bg-amber-950/40"
                      >
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
                  <div className="space-y-1.5">
                    <Label htmlFor="follow-up-due-date">Due</Label>
                    <Input
                      id="follow-up-due-date"
                      name="dueDate"
                      type="datetime-local"
                      required
                      defaultValue={defaultDueDate}
                    />
                  </div>
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
