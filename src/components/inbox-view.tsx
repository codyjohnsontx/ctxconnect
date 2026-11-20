import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ArrowLeft, ChevronRight, Clock3, MessageCircle, Search, Sparkles, StickyNote } from "lucide-react";
import { addInternalNote, createTask, markConversationUnread, updateTaskStatus } from "@/app/actions";
import { AiOpsBrief } from "@/components/ai-ops-brief";
import { ConsentBadge } from "@/components/consent-badge";
import { ConversationControls } from "@/components/conversation-controls";
import { CustomerProfile } from "@/components/customer-profile";
import { FollowUpDueDate } from "@/components/follow-up-due-date";
import { MarkReadOnOpen } from "@/components/mark-read-on-open";
import { MessageComposer } from "@/components/message-composer";
import { QueueStatus } from "@/components/queue-status";
import { RescheduleFollowUp } from "@/components/reschedule-follow-up";
import { ThreadMessages } from "@/components/thread-messages";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/section-header";
import { ConversationStatus, Department, MessageDirection, Priority, TaskStatus } from "@/generated/prisma/client";
import { hasCurrentBrief } from "@/lib/ai/ambient-pass";
import { cachedConsentState, describeConsent } from "@/lib/consent";
import { handOffReasons } from "@/lib/conversation-controls-state";
import { isUnnamedCustomer } from "@/lib/customer-identity";
import type { AppUser, getInboxData } from "@/lib/data";
import { INBOX_FILTER_KEYS, clearFiltersHref, clearSearchHref, countActiveFilters } from "@/lib/inbox-filters";
import { canUpdateTask } from "@/lib/permissions";
import { containsTerm } from "@/lib/search";
import {
  UNDELIVERED_HEADLINE,
  UNDELIVERED_ROW_LABEL,
  hasUndeliveredReply,
  isUndelivered,
  lastUndeliveredOutbound,
  undeliveredDetail,
} from "@/lib/message-delivery";
import { type PreviewAuthor, previewAttribution } from "@/lib/message-preview";
import type { SendBlock } from "@/lib/send-gate";
import { CONVERSATION_PANEL_ATTRIBUTE } from "@/lib/thread-scroll";
import { cn, formatPhone, labelize } from "@/lib/utils";

type InboxData = Awaited<ReturnType<typeof getInboxData>>;

const departments = Object.values(Department);
const statuses = Object.values(ConversationStatus);
const priorities = Object.values(Priority);

const statusTone: Record<ConversationStatus, BadgeVariant> = {
  OPEN: "info",
  WAITING_ON_CUSTOMER: "warning",
  WAITING_ON_STAFF: "critical",
  FOLLOW_UP_NEEDED: "warning",
  CLOSED: "success",
};

// A previewed message that is not the customer's gets a label in the voice's
// own colour: warning for a note, matching the note bubble in the thread, and
// plain muted for a staff reply, which is ordinary rather than notable.
const authorTone: Record<PreviewAuthor, string> = {
  staff: "text-text-muted",
  note: "text-warning",
};

const aiRiskTone: Record<Priority, BadgeVariant> = {
  LOW: "success",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "critical",
};

// The one link style for leaving a search or a filter behind.
const linkClass = "text-200 font-medium text-accent underline-offset-2 hover:underline";
const mutedLinkClass =
  "inline-flex items-center gap-1 text-200 font-medium text-text-muted underline-offset-2 transition-colors hover:text-text hover:underline";

// Every section of the right-hand panel: one rule under it, the same padding,
// and whatever it holds stacked at the same gap.
const panelSectionClass = "flex flex-col gap-3 border-b border-border p-4";

type InboxViewProps = InboxData & {
  selectedId?: string;
  searchParams: Record<string, string | undefined>;
  isDemo?: boolean;
  currentUser: AppUser;
  /** The send gate's answer for the open thread, from `previewSendBlock`. */
  sendBlock?: SendBlock | null;
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

// Read the clock once per request, outside any component render, so every
// follow-up is compared against the same instant and the render stays pure.
// Same reason and same shape as the tasks page's overdue check.
function nowTimestamp() {
  return Date.now();
}

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
  search,
  searchParams,
  isDemo,
  currentUser,
  sendBlock = null,
}: InboxViewProps) {
  const selectedVehicle = selectedConversation?.customer.vehicles[0];
  // null rather than a stand-in word: a template that names the bike should ask
  // for it, not text the customer about "your unit".
  const unit = selectedVehicle
    ? `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`
    : null;
  // null for the same reason as the unit above: an unassigned thread has no
  // advisor to name, and "the team" texted the customer a stand-in where a
  // person belongs. The template already knows how to ask - it leaves
  // `[advisor name]` and holds Send - but only if nothing answers for it first.
  const advisorName = selectedConversation?.assignedUser?.name ?? null;
  // And the same again for the customer: a number nobody has met is stored
  // under "Unknown 4821", which is a label for the queue, not a name to open a
  // text with. The placeholder check lives with the webhook that writes it.
  const customerName =
    selectedConversation && !isUnnamedCustomer(selectedConversation.customer.name, selectedConversation.customer.phone)
      ? selectedConversation.customer.name
      : null;
  const selectedBriefIsCurrent = selectedConversation ? hasCurrentBrief(selectedConversation) : true;
  const backTarget = searchParams.from ? BACK_TARGETS[searchParams.from] ?? null : null;
  // Validated against the enum rather than printed: it arrives on the URL, and
  // the banner should never render whatever a hand-typed query string says. The
  // reason is checked the same way, and an unrecognised one reads as the
  // department move the named department already points at.
  const movedTo = departments.find((department) => department === searchParams.movedTo) ?? null;
  const movedWhy = handOffReasons.find((reason) => reason === searchParams.handOff) ?? "department";
  const searchTerm = search.term;
  // Leaving the search keeps the filters she also set, and keeps her place: a
  // search that came up empty is not a reason to throw away either.
  const clearSearchTarget = clearSearchHref(searchParams, selectedConversation?.id);
  const now = nowTimestamp();
  // Formatted here rather than in the brief panel so the duplicate warning and
  // the "Open follow-ups" list below it read the same due date the same way.
  const openFollowUps = (selectedConversation?.tasks ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    dueLabel: formatDistanceToNow(task.dueDate, { addSuffix: true }),
    // The instant itself, for the reschedule panel to read into its picker in
    // the advisor's own timezone rather than the server's.
    dueAt: task.dueDate.toISOString(),
    // Every follow-up in this list is still open, so a due date in the past is
    // overdue with nothing else to ask.
    isOverdue: task.dueDate.getTime() < now,
    assigneeName: task.assignedUser?.name ?? "Unassigned",
    department: task.department,
    // A thread can carry a follow-up another department owns, and offering a
    // button the write would refuse is worse than not offering one.
    canComplete: canUpdateTask(currentUser, task),
  }));
  const activeFilterCount = countActiveFilters(searchParams);
  const clearFiltersTarget = clearFiltersHref(searchParams, selectedConversation?.id);
  // Remounts the controls whenever the URL's filters change. They are
  // uncontrolled, so React reuses the existing DOM nodes across a same-page
  // navigation and `defaultValue` and `defaultChecked` would keep showing the
  // filters she just left - including the fold, which would stay shut over a
  // queue that is now narrowed, or hang open after Clear filters.
  const filterControlsKey = INBOX_FILTER_KEYS.map((key) => searchParams[key] ?? "").join("|");
  // The thread is rendered oldest message first, so its newest is the last one.
  const latestMessage = selectedConversation?.messages.at(-1) ?? null;

  return (
    <div className="grid h-dvh min-h-0 grid-rows-[minmax(0,1fr)] lg:grid-cols-[var(--layout-queue-width)_minmax(0,1fr)] lg:grid-rows-1">
      <section className={cn("min-h-0 flex-col border-r border-border bg-surface", selectedConversation ? "hidden lg:flex" : "flex")}>
        <div className="relative z-10 flex shrink-0 flex-col gap-2 border-b border-border bg-surface px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-600 font-semibold tracking-tight">Inbox</h1>
            <Badge variant="info">Shared</Badge>
          </div>
          <p className="text-text-muted">
            {searchTerm
              ? `${conversations.length} ${conversations.length === 1 ? "match" : "matches"} for “${searchTerm}”`
              : `${conversations.length} conversations, ranked by what the AI flagged`}
          </p>
          {/* Set by a save that moved a thread out of this advisor's reach.
              Without it the save silently swaps her open conversation for a bare
              404, which reads like the app lost her place. It says which of the
              two things happened for the same reason the panel's warning does:
              an assignment can carry the thread off without the department
              moving anywhere. */}
          {movedTo ? (
            <Alert variant="info" inline>
              {movedWhy === "department"
                ? `Handed off to ${labelize(movedTo)}. That conversation has left your inbox.`
                : "That conversation was taken off you. It has left your inbox."}
            </Alert>
          ) : null}
          <QueueStatus status={queueStatus} />
          {/* Above the filters rather than among them: a customer on the phone
              is the one moment the advisor cannot scroll a queue, and the
              filters cannot narrow to a person at all. */}
          <div>
            {/* Keyed by the term for the same reason the controls below are:
                the box is uncontrolled, so across a same-page navigation React
                would keep showing the term she has just cleared. Enter submits
                it; the glyph says what the box is for. */}
            <form key={`search-${searchTerm}`} className="relative" action="/inbox">
              {/* The filters she already set survive a search, the same way the
                  search survives pressing Filter. */}
              {INBOX_FILTER_KEYS.map((key) =>
                searchParams[key] ? (
                  <input key={key} type="hidden" name={key} value={searchParams[key]} />
                ) : null,
              )}
              <Search
                className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                name="q"
                defaultValue={searchTerm}
                placeholder="Search name, phone, or text"
                aria-label="Search conversations"
                className="pl-8"
              />
            </form>
            {searchTerm ? (
              <div className="mt-1 flex justify-end">
                <Link href={clearSearchTarget} className={linkClass}>
                  Clear search
                </Link>
              </div>
            ) : null}
          </div>
          {/* On a phone the ranked queue is what she opened the app for, and the
              controls that narrow it were pushing the first row most of the way
              down the screen, so below `lg` they fold away behind their own
              summary. The wide layout has a rail with room for both and is left
              as it was.

              A checkbox rather than <details>: only CSS can collapse the same
              markup at one breakpoint and leave it open at the other, and no
              author style can reopen a closed <details>. It starts open whenever
              a filter is in effect, so a narrowed queue always shows what
              narrowed it. The checkbox is hidden rather than merely off-screen
              from `lg` up, so the wide layout does not offer assistive
              technology a control for a fold it does not have. */}
          <input
            key={filterControlsKey}
            id="inbox-filters-toggle"
            aria-controls="inbox-filters"
            type="checkbox"
            className="peer sr-only lg:hidden"
            defaultChecked={activeFilterCount > 0}
          />
          <label
            htmlFor="inbox-filters-toggle"
            className="flex h-7 cursor-pointer items-center gap-1 text-text-muted peer-checked:[&>svg]:rotate-90 lg:hidden"
          >
            <ChevronRight className="size-4 shrink-0 transition-transform" />
            Filters
            {activeFilterCount > 0 ? <Badge variant="accent">{activeFilterCount} active</Badge> : null}
          </label>
          <div id="inbox-filters" className="hidden peer-checked:block lg:block">
            <form key={filterControlsKey} className="grid grid-cols-2 gap-2" action="/inbox">
              {/* Same reason the search carries the filters: filtering while a
                  search is in effect must narrow those results, not abandon the
                  customer she was looking for. */}
              {searchTerm ? <input type="hidden" name="q" value={searchTerm} /> : null}
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
              <Checkbox name="unread" value="true" defaultChecked={searchParams.unread === "true"} label="Unread" />
              <Checkbox name="failed" value="true" defaultChecked={searchParams.failed === "true"} label="Failed" />
              <Checkbox
                name="needsAction"
                value="true"
                defaultChecked={searchParams.needsAction === "true"}
                label="Needs action"
              />
              <Button type="submit" variant="secondary">
                Filter
              </Button>
            </form>
            {/* Only when the filters left something to look at. A queue filtered
                to nothing carries its own way out in the empty state a few
                pixels below, and two of them together read as two different
                exits. */}
            {activeFilterCount > 0 && conversations.length > 0 ? (
              <div className="mt-2 flex justify-end">
                <Link href={clearFiltersTarget} className={linkClass}>
                  Clear filters
                </Link>
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-16 lg:pb-0">
          {conversations.length === 0 ? (
            <div className="p-6 text-text-muted">
              {searchTerm ? (
                // Named as the cause, with the way out beside it: a search that
                // came up empty behind a filter she forgot about is the one dead
                // end an advisor reads as "the customer isn't here".
                <>
                  Nothing in your inbox matches “{searchTerm}”.{" "}
                  <Link href={clearSearchTarget} className="font-medium text-accent hover:underline">
                    Clear search
                  </Link>
                  .
                </>
              ) : activeFilterCount > 0 ? (
                <>
                  No conversations match these filters.{" "}
                  <Link href={clearFiltersTarget} className="font-medium text-accent hover:underline">
                    Clear filters
                  </Link>{" "}
                  to see the whole queue.
                </>
              ) : (
                // Nothing is searched and nothing is filtered, so the queue
                // itself is empty. Blaming filters here would send her looking
                // for a control to undo that is not set.
                "No conversations yet."
              )}
            </div>
          ) : (
            conversations.map((conversation) => {
              // The newest message somebody's voice is in: the query loads
              // one message and leaves out the notes Attend wrote itself, so
              // a book just handed over does not arrive as rows all
              // previewing the same sentence about the hand-off.
              const lastMessage = conversation.messages[0] ?? null;
              // Asked of the last reply staff sent, not of the message being
              // previewed. A note or a customer message written afterwards
              // takes over the preview without undoing the failure, and a row
              // that goes quiet then is worse than one that never spoke: this
              // is the surface she scans to decide what to skip.
              const undeliveredReply = hasUndeliveredReply(conversation.newestReply);
              // Whose words the preview is. An inbound message gets nothing:
              // the customer's voice is what a row is read as by default, and
              // her name is already in bold on the line above.
              const previewAuthor = previewAttribution(lastMessage, currentUser.id);
              const hasOpenTask = conversation.tasks.length > 0;
              const selected = selectedConversation?.id === conversation.id;
              const insight = conversation.aiInsights[0];
              // The freshness rule the header counter uses, read from the one
              // place that defines it. A row that presented a brief older than
              // the thread's newest message as the current read would contradict
              // the counter that already excluded it.
              const briefIsCurrent = hasCurrentBrief(conversation);

              return (
                // The selected row is the one place the queue uses the accent:
                // a two-pixel left edge and the accent surface.
                <Link
                  key={conversation.id}
                  href={buildHref(conversation.id, searchParams)}
                  className={cn(
                    "block border-b border-l-2 border-border border-l-transparent px-4 py-3 transition-colors hover:bg-surface-raised",
                    selected && "border-l-accent bg-accent-surface hover:bg-accent-surface",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      {conversation.unread ? (
                        <>
                          <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                          <span className="sr-only">Unread</span>
                        </>
                      ) : null}
                      <span className="truncate">{conversation.customer.name}</span>
                    </span>
                    <span className="shrink-0 text-200 text-text-faint">
                      {formatDistanceToNow(conversation.lastMessageAt, { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-200 text-text-faint">{formatPhone(conversation.customer.phone)}</p>
                  {undeliveredReply ? (
                    // Its own line above the preview rather than a prefix on it:
                    // the failed reply is usually no longer the text being
                    // previewed, and a prefix would read as though whatever is
                    // previewed had failed.
                    <p className="mt-1 flex items-center gap-1 text-200 font-semibold text-critical">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      {UNDELIVERED_ROW_LABEL}
                    </p>
                  ) : null}
                  <p className="mt-1 line-clamp-2 break-words text-text-muted">
                    {previewAuthor ? (
                      <span className={cn("font-semibold", authorTone[previewAuthor.author])}>
                        {previewAuthor.label}{" "}
                      </span>
                    ) : null}
                    {lastMessage?.body ?? conversation.subject ?? "No messages yet"}
                  </p>
                  {/* Only when the preview does not already carry the term: a
                      row matched on an older message otherwise looks like a
                      result the search made up. */}
                  {searchTerm &&
                  search.snippets[conversation.id] &&
                  !containsTerm(lastMessage?.body ?? "", searchTerm) ? (
                    <p className="mt-1 line-clamp-2 break-words text-200 text-text-muted">
                      <span className="font-medium">Matched message:</span>{" "}
                      {search.snippets[conversation.id]}
                    </p>
                  ) : null}
                  {insight && !insight.dismissedAt ? (
                    // The AI's voice is the info tone, as a line rather than a box.
                    <p className="mt-1 flex gap-1 text-200 text-info">
                      <Sparkles className="mt-px size-3 shrink-0" aria-hidden="true" />
                      <span className="line-clamp-2">
                        {briefIsCurrent
                          ? insight.suggestedNextAction
                          : `Earlier brief: ${insight.suggestedNextAction}`}
                      </span>
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {insight ? (
                      insight.dismissedAt ? (
                        <Badge>Dismissed</Badge>
                      ) : (
                        <Badge variant={briefIsCurrent ? aiRiskTone[insight.riskLevel] : "neutral"}>
                          <Sparkles className="size-3" aria-hidden="true" />
                          {briefIsCurrent
                            ? labelize(insight.riskLevel)
                            : `${labelize(insight.riskLevel)} · earlier brief`}
                        </Badge>
                      )
                    ) : (
                      <Badge>Not briefed</Badge>
                    )}
                    {insight?.escalationRecommended && !insight.dismissedAt ? (
                      <Badge variant={briefIsCurrent ? "critical" : "neutral"}>
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
                      <Badge variant="critical">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {labelize(conversation.priority)}
                      </Badge>
                    ) : null}
                    {hasOpenTask ? (
                      <Badge variant="warning">
                        <Clock3 className="size-3" aria-hidden="true" />
                        Follow-up
                      </Badge>
                    ) : null}
                    {/* A tag is a label, not a status, so it takes the neutral
                        badge rather than a colour of its own. */}
                    {conversation.tags.map(({ tag }) => (
                      <Badge key={tag.id}>{tag.name}</Badge>
                    ))}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>

      {selectedConversation ? (
        <section className="flex min-h-0 flex-col overflow-y-auto pb-16 lg:grid lg:grid-cols-[minmax(0,1fr)_var(--layout-panel-width)] lg:overflow-hidden lg:pb-0">
          {/* The conversation and the box she answers it in, as one panel: on a
              phone it is what the page scrolls to, so both land on screen
              together. See components/thread-messages.tsx. */}
          <div {...{ [CONVERSATION_PANEL_ATTRIBUTE]: "" }} className="flex min-h-0 shrink-0 flex-col bg-page">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface px-4 py-3 lg:static lg:px-5">
              <div className="min-w-0">
                {backTarget ? (
                  <Link href={backTarget.href} className={cn(mutedLinkClass, "mb-1")}>
                    <ArrowLeft className="size-3.5" />
                    {backTarget.label}
                  </Link>
                ) : (
                  // On mobile the conversation list is hidden when a thread is open,
                  // so give an inbox-origin conversation a way back to the list.
                  <Link href="/inbox" className={cn(mutedLinkClass, "mb-1 lg:hidden")}>
                    <ArrowLeft className="size-3.5" />
                    Back to inbox
                  </Link>
                )}
                <h2 className="truncate text-500 font-semibold tracking-tight">{selectedConversation.customer.name}</h2>
                <p className="text-text-muted">
                  {selectedConversation.subject ?? labelize(selectedConversation.department)} ·{" "}
                  <span className="whitespace-nowrap">{formatPhone(selectedConversation.customer.phone)}</span>
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <ConsentBadge consent={describeConsent(cachedConsentState(selectedConversation.customer))} />
                {/* The way to hand a thread back to the floor. Reading clears
                    the marker, so without this the advisor loses the only way
                    she has to say "someone still needs to pick this up". */}
                {selectedConversation.unread ? (
                  <span className="inline-flex items-center gap-1 text-200 font-medium text-accent">
                    <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
                    Unread
                  </span>
                ) : (
                  <form action={markConversationUnread}>
                    <input type="hidden" name="conversationId" value={selectedConversation.id} />
                    {/* Sized on the span: a text-* utility on the button itself
                        loses to the font: inherit reset in globals.css. */}
                    <button type="submit" className="text-text-muted underline-offset-2 transition-colors hover:text-text hover:underline">
                      <span className="text-200 font-medium">Mark unread</span>
                    </button>
                  </form>
                )}
              </div>
            </header>

            {/* Opening the thread is what makes it read - see the action. */}
            <MarkReadOnOpen
              conversationId={selectedConversation.id}
              unread={selectedConversation.unread}
            />

            {/* Keyed by conversation so opening another thread remounts the box
                and lands on that thread's newest message rather than keeping
                the scroll position of the one she just left. Prefixed because
                the composer below is a sibling keyed by the same conversation,
                and React wants the two keys to differ. */}
            <ThreadMessages
              key={`messages-${selectedConversation.id}`}
              latestMessageId={latestMessage?.id ?? null}
              latestMessageIsHers={latestMessage?.senderUserId === currentUser.id}
              // On a phone the conversation is part of the page rather than a
              // window inside it: a fixed-height box gave a 390x844 screen a
              // 287px porthole onto the thread, with its own scrollbar inside a
              // page that scrolled separately. On a wide screen the thread
              // column has room to be its own scrolling box, so it is.
              className="flex flex-none flex-col gap-3 p-4 lg:flex-1 lg:overflow-y-auto lg:px-5"
            >
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
                    {/* Sent texts are a gray tint rather than the accent, so the
                        only colour in a thread is meaning: the warning tint on a
                        note a person left, and critical on a reply that never
                        arrived. */}
                    <div
                      className={cn(
                        "max-w-(--size-thread-max) rounded-lg border border-border bg-surface px-3 py-2",
                        outbound && "bg-surface-strong",
                        internal && "max-w-(--size-note-max) border-warning-border bg-warning-surface",
                        // An undelivered reply keeps the sent bubble's shape and side,
                        // because that is where she wrote it, but loses the delivered
                        // bubble's colour so the two can never be skimmed as the same
                        // thing.
                        undelivered && "border-critical-border bg-critical-surface",
                      )}
                    >
                      <div className={cn("mb-1 flex items-center gap-1 text-200", internal ? "text-warning" : "text-text-muted")}>
                        {internal ? <StickyNote className="size-3" aria-hidden="true" /> : <MessageCircle className="size-3" aria-hidden="true" />}
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
                      <p className="whitespace-pre-wrap break-words leading-5">{message.body}</p>
                      {undelivered ? (
                        <div className="mt-2 flex items-start gap-1 text-200 font-semibold text-critical">
                          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            {UNDELIVERED_HEADLINE}
                            {undeliveredCause ? (
                              <span className="block font-normal text-text-muted">{undeliveredCause}</span>
                            ) : null}
                          </span>
                        </div>
                      ) : null}
                      <div className="mt-1 text-100 text-text-faint">
                        {formatDistanceToNow(message.createdAt, { addSuffix: true })} · {labelize(message.deliveryStatus)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </ThreadMessages>

            <MessageComposer
              key={selectedConversation.id}
              conversationId={selectedConversation.id}
              userId={currentUser.id}
              customerName={customerName}
              advisorName={advisorName}
              dealershipName={dealershipSettings.dealershipName}
              unit={unit}
              department={selectedConversation.department}
              templates={templates}
              sendBlock={sendBlock}
              demoBlocked={isDemo}
              unsentBody={lastUndeliveredOutbound(selectedConversation.messages)?.body ?? null}
            />
          </div>

          <aside className="min-h-0 shrink-0 border-t border-border bg-surface lg:overflow-y-auto lg:border-t-0 lg:border-l">
            <section className={panelSectionClass}>
              <AiOpsBrief
                key={selectedConversation.id}
                conversationId={selectedConversation.id}
                initialInsight={selectedConversation.aiInsights[0] ?? null}
                openFollowUps={openFollowUps}
                briefIsCurrent={selectedBriefIsCurrent}
              />
            </section>

            <section className={panelSectionClass}>
              <SectionHeader title="Conversation controls" />
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

            <section className={panelSectionClass}>
              <SectionHeader title="Customer profile" />
              <CustomerProfile
                key={`customer-profile-${selectedConversation.customer.id}`}
                customer={{
                  id: selectedConversation.customer.id,
                  name: selectedConversation.customer.name,
                  phone: selectedConversation.customer.phone,
                  email: selectedConversation.customer.email,
                  notes: selectedConversation.customer.notes,
                  preferredContactMethod: selectedConversation.customer.preferredContactMethod,
                }}
                consent={describeConsent(cachedConsentState(selectedConversation.customer))}
              />
            </section>

            <section className={panelSectionClass}>
              <SectionHeader title="Units" />
              {selectedConversation.customer.vehicles.map((vehicle) => (
                <div key={vehicle.id} className="rounded-md border border-border p-3">
                  <div className="font-medium">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </div>
                  <div className="text-200 text-text-muted">
                    {labelize(vehicle.relationship)} · VIN {vehicle.vin ?? "n/a"}
                  </div>
                  <div className="text-200 text-text-muted">
                    Stock {vehicle.stockNumber ?? "n/a"} · {vehicle.mileage?.toLocaleString() ?? 0} mi
                  </div>
                </div>
              ))}
            </section>

            <section className={panelSectionClass}>
              <SectionHeader
                title="Open follow-ups"
                trailing={openFollowUps.length > 0 ? openFollowUps.length : null}
              />
              {openFollowUps.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-3 text-text-muted">No open follow-ups.</p>
              ) : (
                openFollowUps.map((followUp) => (
                  // The brief's "See the follow-up" lands here, so the card
                  // needs an anchor and room to clear the sticky header. The
                  // warning tint marks the one she was sent to, the same tone
                  // as any open follow-up; overdue says so in its own words.
                  <div
                    key={followUp.id}
                    id={`follow-up-${followUp.id}`}
                    className="scroll-mt-6 rounded-md border border-border p-3 target:border-warning-border target:bg-warning-surface"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{followUp.title}</span>
                      {followUp.isOverdue ? <Badge variant="critical">Overdue</Badge> : null}
                    </div>
                    <div className="mt-1 text-200 text-text-muted">
                      <span className={followUp.isOverdue ? "font-medium text-critical" : undefined}>
                        Due {followUp.dueLabel}
                      </span>{" "}
                      · {followUp.assigneeName}
                    </div>
                    {followUp.canComplete ? (
                      // Closing the loop belongs where the work happens.
                      // Sending her to the tasks list to find this row again
                      // is how a finished follow-up stays open and the queue
                      // stops meaning anything.
                      <div className="mt-2 flex flex-wrap items-start gap-2">
                        <form action={updateTaskStatus}>
                          <input type="hidden" name="taskId" value={followUp.id} />
                          <input type="hidden" name="status" value={TaskStatus.DONE} />
                          <Button type="submit" variant="secondary" size="sm">
                            Mark done
                          </Button>
                        </form>
                        {/* The customer moving the plan is something she is
                            told here, in the thread - so this is where the
                            follow-up has to be able to move with it, rather
                            than being marked done to get it off the queue. */}
                        <RescheduleFollowUp taskId={followUp.id} dueAt={followUp.dueAt} />
                      </div>
                    ) : (
                      <p className="mt-2 text-200 text-text-muted">
                        {labelize(followUp.department)} closes this one.
                      </p>
                    )}
                  </div>
                ))
              )}
            </section>

            <section className={panelSectionClass}>
              <SectionHeader title="Add internal note" />
              <form action={addInternalNote} className="flex flex-col gap-2">
                <input type="hidden" name="conversationId" value={selectedConversation.id} />
                <input type="hidden" name="aiInsightId" data-ai-note-insight />
                <Textarea name="body" placeholder="Visible only to staff..." aria-label="Internal note" />
                <Button type="submit" variant="secondary" className="w-full">
                  Save note
                </Button>
              </form>
            </section>

            <section className={panelSectionClass}>
              <SectionHeader title="Create follow-up" />
              <form action={createTask} className="flex flex-col gap-2">
                <input type="hidden" name="customerId" value={selectedConversation.customerId} />
                <input type="hidden" name="conversationId" value={selectedConversation.id} />
                <input type="hidden" name="aiInsightId" data-ai-follow-up-insight />
                <Input name="title" placeholder="Task title" aria-label="Task title" required />
                <Textarea name="description" placeholder="Optional details" aria-label="Details" className="min-h-8" />
                <Select name="assignedUserId" defaultValue={selectedConversation.assignedUserId ?? "unassigned"} aria-label="Assignee">
                  <option value="unassigned">Unassigned</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <Select name="department" defaultValue={selectedConversation.department} aria-label="Department">
                    {departments.map((department) => (
                      <option key={department} value={department}>
                        {labelize(department)}
                      </option>
                    ))}
                  </Select>
                  <Select name="priority" defaultValue={selectedConversation.priority} aria-label="Priority">
                    {priorities.map((priority) => (
                      <option key={priority} value={priority}>
                        {labelize(priority)}
                      </option>
                    ))}
                  </Select>
                </div>
                {/* Her clock, not the server's: the picker's value carries no
                    offset, so both the default and the conversion belong in the
                    browser. */}
                <FollowUpDueDate />
                <Button type="submit" variant="secondary" className="w-full">
                  Add follow-up
                </Button>
              </form>
            </section>
          </aside>
        </section>
      ) : (
        <section className="hidden min-h-0 items-center justify-center bg-page p-8 lg:flex">
          <div className="max-w-sm text-center">
            <MessageCircle className="mx-auto mb-4 size-10 text-text-faint" aria-hidden="true" />
            <h2 className="text-500 font-semibold tracking-tight">Select a conversation</h2>
            <p className="mt-2 text-text-muted">
              Open a customer thread to view messages, profile context, templates, and follow-ups.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
