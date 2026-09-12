/**
 * One operational fact - a thread with no owner, a text that failed, a
 * follow-up past its time - is stored as several Notification rows: one per
 * manager, plus one for the follow-up's assignee, because each recipient owns
 * their own row. Any reader whose scope covers more than one of those
 * recipients therefore reads the same fact several times over. A service
 * advisor sees every row tagged with her department, so a dealership with two
 * managers shows her each alert three times; a manager's scope is the whole
 * dealership, so they see every copy too.
 *
 * These helpers collapse the rows back down to the facts before anything is
 * listed or counted, so the alert rail, the Command Center and their counters
 * share one rule. Nothing here opens a connection, so the rule can be worked
 * out and tested without a database. It is still server-only: one of the three
 * forms below is built with `Prisma.sql`, which carries the client runtime, and
 * a client component that imports this module fails the build.
 *
 * What makes two rows one fact is the thread they are about, not the message
 * that raised them. A thread with no owner is one thing to do however many
 * texts have arrived on it, and so is a thread with unanswered customer
 * messages. The single exception is a text that failed to send: two failed
 * texts on one thread are two things to fix, so those keep the message.
 *
 * That rule is needed in three forms, because a list is collapsed after its
 * rows are read, a badge must be one number the database works out on its own,
 * and a row has to be written with the subject the other two will read back.
 * All three are built here, from the same two lists, so nothing can teach one
 * of them a rule the others have not learned - and the write form is a type,
 * so a writer that has not learned it does not compile.
 */

import { type Department, Prisma } from "@/generated/prisma/client";
import { NotificationStatus, NotificationType, Priority } from "@/generated/prisma/enums";
import { canSeeAll } from "@/lib/conversation-access";
import type { AppUser } from "@/lib/data";

export type NotificationFact = {
  type: string;
  conversationId?: string | null;
  taskId?: string | null;
  messageId?: string | null;
  recipientUserId?: string | null;
};

/** The subject the two states of one follow-up share. */
export const followUpSubject = "FOLLOW_UP";

// A follow-up that is due today and one that is already late are the same
// follow-up. The operational sweep raises the overdue row when the clock
// passes the due date and only withdraws the "due today" row the next time it
// runs, so the two have to read as one alert in between or the advisor is
// told a follow-up is both still coming and already late.
export const followUpTypes = [
  NotificationType.FOLLOW_UP_DUE,
  NotificationType.FOLLOW_UP_OVERDUE,
] as const;

// The alerts whose fact really is one message rather than the thread: two
// texts that failed to send on one thread are two things to fix and must not
// collapse into one. Every other alert describes the thread itself - it has no
// owner, it has an unanswered customer message, it missed its SLA - so the
// message it happened to be raised from stays out of the key, and is named
// apart from it in `NotificationSubject` below so a writer cannot put one
// there. Keying on it splits one unowned thread into two alerts and one busy
// thread into an alert per text.
export const perMessageTypes = [NotificationType.MESSAGE_FAILED] as const;

/**
 * How an alert ranks, worked out from the fact rather than chosen by whoever
 * writes it.
 *
 * Ranking is a property of the fact, not of the writer, and the two writers of
 * an unowned thread proved it: the webhook hard-coded `Priority.HIGH` while the
 * sweep passed `conversation.priority`, so a LOW thread whose text arrived at
 * the webhook was listed HIGH - above every NORMAL and LOW alert in a rail that
 * orders by priority and only reads so far. Wording is the writer's own, since
 * the webhook can quote the text that just landed and the sweep has none. The
 * rank is not, so it is decided here, once, for every writer.
 *
 * Two kinds of alert. Most describe a thread or a follow-up and inherit its
 * rank, so an escalated thread's alert escalates with it. The three below carry
 * a rank of their own because the event is the severity: a missed response
 * clock is the dealership's worst kind of failure whatever the thread was
 * ranked at, and a text that never reached the customer is urgent work on a
 * thread nobody thought was urgent.
 *
 * That rank stands in place of the subject's, in either direction. It is a
 * replacement rather than a floor, so it lifts a quiet subject's alert and
 * lowers a loud one: an URGENT follow-up's alert reads URGENT while it is
 * merely due and drops to HIGH the moment it goes late, and a failed text on an
 * URGENT thread reads HIGH. That is what this computes today, and
 * `tests/notification-priority.test.ts` pins both directions.
 *
 * That test also pins which types are which, so adding an alert type is a
 * decision rather than a default.
 */
const fixedNotificationPriorities: Partial<Record<NotificationType, Priority>> = {
  [NotificationType.SLA_MISSED]: Priority.URGENT,
  [NotificationType.MESSAGE_FAILED]: Priority.HIGH,
  [NotificationType.FOLLOW_UP_OVERDUE]: Priority.HIGH,
};

/**
 * The rank of an alert of this type about a thread or follow-up ranked
 * `subjectPriority`. Types with a rank of their own ignore the subject's.
 */
export function notificationPriority(
  type: NotificationType,
  subjectPriority: Priority,
): Priority {
  return fixedNotificationPriorities[type] ?? subjectPriority;
}

/** The alerts that inherit the rank of the thread or follow-up they are about. */
export const subjectRankedNotificationTypes: NotificationType[] = Object.values(
  NotificationType,
).filter((type) => !(type in fixedNotificationPriorities));

/**
 * The alerts that opening a conversation withdraws.
 *
 * Reading is not answering. A missed response clock, a text that never reached
 * the customer, an unowned thread and a follow-up past its time all describe
 * work that is still undone after the advisor has read the thread, so none of
 * them may be withdrawn by her opening it. The only alert whose whole job was
 * to say "a message arrived" is. Adding anything else here silences a clock
 * that is still running.
 */
export const readResolvesNotificationTypes: NotificationType[] = [
  NotificationType.NEW_INBOUND_MESSAGE,
];

/**
 * The alerts a thread raises against whoever is holding it, which is why they
 * follow the thread when it changes hands. A row is stored per recipient, so an
 * alert left addressed to an advisor who has gone away is an alert nobody's
 * rail can show - the work is still there and the one person now doing it is
 * not told about it.
 *
 * The three types here are the ones written to `conversation.assignedUserId`.
 * Everything else on a thread is addressed to managers, who are not the ones
 * changing, and a follow-up's alerts go to the *task's* assignee - coverage
 * moves conversations, not follow-ups, and `src/lib/task-access.ts` already
 * lets the department work one either way.
 */
export const assigneeAddressedTypes: NotificationType[] = [
  NotificationType.NEW_INBOUND_MESSAGE,
  NotificationType.CONVERSATION_ASSIGNED,
  NotificationType.CONVERSATION_REASSIGNED,
];

// The two lists are fixed tuples so the shapes a writer may build can be
// derived from them below. A stored row's `type` arrives here as a plain
// string, though, so widen them again to ask whether it is in one.
function names(types: readonly NotificationType[]): readonly string[] {
  return types;
}

export function notificationFactKey(notification: NotificationFact): string {
  const subject = names(followUpTypes).includes(notification.type)
    ? followUpSubject
    : notification.type;
  const message = names(perMessageTypes).includes(notification.type)
    ? (notification.messageId ?? "")
    : "";

  return [subject, notification.conversationId ?? "", notification.taskId ?? "", message].join(" ");
}

/**
 * The alerts that follow a conversation when it changes hands.
 *
 * Status is deliberately not part of it. `reopenConversationNotifications`
 * revives a resolved row whenever somebody marks the thread unread, and it
 * revives on the rail it was addressed to - so a resolved row left behind comes
 * back to an advisor who no longer holds the thread, which is the failure
 * re-addressing exists to prevent, one hop later. Nothing is preserved by
 * skipping it either: `recipientUserId` is the addressee, there is no column
 * saying who resolved a row, and a thread's alerts are resolved for every
 * recipient at once.
 */
export function assigneeAddressedNotificationsWhere(conversationIds: string[]) {
  return {
    conversationId: { in: conversationIds },
    type: { in: assigneeAddressedTypes },
  } satisfies Prisma.NotificationWhereInput;
}

/**
 * Every stored row that carries this fact, whoever it is addressed to and
 * whatever text each was raised from.
 *
 * The narrower question - which single row a writer is about to duplicate - is
 * asked with all the stored columns, because a thread alert deliberately keeps
 * the text it was raised from and a later text is a new row
 * (content/decisions/2026-08-19-thread-alerts-keep-the-text-that-raised-them.md).
 * This is the wider one, and it is the scope a rank has to be corrected over: a
 * row raised from one inbound text is never revisited by its writer - that text
 * will not arrive again - so a thread re-ranked afterwards would leave that copy
 * standing at the old rank forever. The rail reads rows in priority order before
 * collapsing them, so the stale copy is the one it shows.
 *
 * The recipient is deliberately not part of it, and that is what makes this the
 * whole fact rather than one person's share of it. A rank is recipient-independent
 * by construction: `notificationPriority` is given the type and the subject's
 * priority and never the recipient, so two copies of one fact cannot legitimately
 * hold different ranks. Scoping the correction per recipient therefore fixed
 * nothing and left copies that nothing would ever reach. A deactivated manager is
 * the concrete case: `updateStaffUserStatus` resolves none of their rows, and
 * `assigneeAddressedTypes` leaves UNASSIGNED_CONVERSATION out so coverage
 * re-addressing never reaches them either, while the sweep raises only for active
 * managers. That copy kept its old rank for good, and a manager's rail scope is
 * `{}`, so the rail read it, ordered it first at the stale rank, and
 * `dedupeNotificationFacts` handed the fact the slot of that first copy - a quiet
 * LOW thread sitting at the top of the rail ahead of genuinely urgent work.
 * Widening it is also strictly fewer writes: once the first recipient's raise has
 * converged every copy, each later recipient's update in the same sweep matches
 * nothing.
 *
 * `type` is matched exactly rather than through `followUpSubject`, because a
 * follow-up that is due and one that is overdue rank differently on purpose.
 * The message is part of the question only where it is part of the fact.
 */
export function sameFactNotificationsWhere(row: {
  type: NotificationType;
  conversationId?: string | null;
  taskId?: string | null;
  messageId?: string | null;
}): Prisma.NotificationWhereInput {
  return {
    type: row.type,
    conversationId: row.conversationId ?? null,
    taskId: row.taskId ?? null,
    ...(names(perMessageTypes).includes(row.type) ? { messageId: row.messageId ?? null } : {}),
  };
}

/** One outstanding alert, as much of one as the rule below reads. */
export type OutstandingNotification = NotificationFact & {
  id: string;
  createdAt: Date;
};

/**
 * Which of these alerts are a second copy of a fact another one already
 * carries, and can therefore be withdrawn.
 *
 * Asked of outstanding rows only, because a resolved copy occupies no rail slot
 * and costs nothing by existing. What the copies cost while they stand is scan
 * slots: `countNotificationFacts` counts facts, while a list applies its `take`
 * to ROWS and collapses them afterwards, so copies of one fact can push a
 * genuine alert off the end of the list while the badge still counts it.
 *
 * The survivor is the newest copy, which is the one already on screen: a list
 * reads newest first and `dedupeNotificationFacts` keeps the first copy's slot,
 * so withdrawing the older ones changes no row a reader was looking at.
 *
 * Withdrawn means resolved, never deleted - a resolved row is the record that
 * the alert was raised and dealt with. That record is also reversible, so a
 * later `reopenConversationNotifications` on the thread revives these copies
 * along with the rest and the thread is back to holding one alert per inbound
 * text. That is the standing condition of any long-lived thread rather than
 * anything a hand-off creates, and the bound that would end it belongs on the
 * write side - see `notificationScanLimit` below.
 */
export function supersededNotificationCopies(
  notifications: ReadonlyArray<OutstandingNotification>,
): string[] {
  const newest = new Map<string, OutstandingNotification>();
  const superseded: string[] = [];

  for (const notification of notifications) {
    const key = notificationFactKey(notification);
    const held = newest.get(key);

    if (!held) {
      newest.set(key, notification);
      continue;
    }

    if (notification.createdAt > held.createdAt) {
      newest.set(key, notification);
      superseded.push(held.id);
      continue;
    }

    superseded.push(notification.id);
  }

  return superseded;
}

/** The three kinds of subject an alert can have, read off the two lists above. */
export type PerMessageNotificationType = (typeof perMessageTypes)[number];
export type FollowUpNotificationType = (typeof followUpTypes)[number];
export type ThreadNotificationType = Exclude<
  NotificationType,
  PerMessageNotificationType | FollowUpNotificationType
>;

/**
 * What an alert is about, in the only shapes the key above can read. A writer
 * names the subject; which columns that subject occupies is the type's
 * business, not the writer's.
 *
 * A per-message alert is about one text, a follow-up is about one task, and
 * every other alert is about one thread. A thread alert may still record the
 * text it happened to be raised from - the sweep has none to give, the webhook
 * does - but it names it `raisedByMessageId`, because that is provenance and
 * the key does not read it. `messageId` on a thread alert is a compile error,
 * which is what stops one unowned thread being written under two keys and
 * listed twice.
 *
 * Why a thread alert still stores that text at all, rather than dropping it and
 * holding one row per recipient, is decided in
 * content/decisions/2026-08-19-thread-alerts-keep-the-text-that-raised-them.md.
 */
export type NotificationSubject =
  | {
      type: PerMessageNotificationType;
      conversationId: string;
      messageId: string;
      taskId?: never;
      raisedByMessageId?: never;
    }
  | {
      type: FollowUpNotificationType;
      taskId: string;
      conversationId?: string | null;
      messageId?: never;
      raisedByMessageId?: never;
    }
  | {
      type: ThreadNotificationType;
      conversationId: string;
      raisedByMessageId?: string | null;
      messageId?: never;
      taskId?: never;
    };

/**
 * That subject as the columns a row stores it in - the one place any writer's
 * ids become a `Notification`.
 *
 * The `messageId` column carries two different things, which is the confusion
 * underneath the double-count: for a per-message alert it is part of what the
 * alert *is* and the key reads it, while for every other alert it is only the
 * text the copy was raised from and the key ignores it. The type above keeps
 * them apart at the call site; this is the single line that puts them back in
 * one column, rather than each writer deciding for itself.
 */
export function notificationSubjectColumns(subject: NotificationSubject) {
  return {
    type: subject.type,
    conversationId: subject.conversationId ?? null,
    taskId: subject.taskId ?? null,
    messageId: subject.messageId ?? subject.raisedByMessageId ?? null,
  };
}

/**
 * The same key, written out for the database and from the same two lists: the
 * four parts in the order `notificationFactKey` joins them. It is what the
 * badge counts distinct values of, so the number over the rail is the number
 * of rows the rail collapses to.
 */
const notificationFactKeySql = Prisma.sql`
  (CASE WHEN "type"::text = ANY(${followUpTypes}) THEN ${followUpSubject} ELSE "type"::text END)
  || ' ' || COALESCE("conversationId", '')
  || ' ' || COALESCE("taskId", '')
  || ' ' || (CASE WHEN "type"::text = ANY(${perMessageTypes}) THEN COALESCE("messageId", '') ELSE '' END)
`;

// Which of the rows describing one fact the reader should actually see: the
// row that describes the follow-up's current state beats the one it
// superseded, and among equals the row addressed to the reader beats a copy
// addressed to somebody else, because hers is worded for her.
function representativeRank(notification: NotificationFact, viewerId?: string | null): number {
  const current = notification.type === NotificationType.FOLLOW_UP_OVERDUE ? 2 : 0;
  const addressedToViewer = viewerId && notification.recipientUserId === viewerId ? 1 : 0;

  return current + addressedToViewer;
}

/**
 * Collapse notification rows to one row per fact, keeping the order the rows
 * arrived in - a fact holds the position of its first copy, even when a later
 * copy is the one shown.
 */
export function dedupeNotificationFacts<T extends NotificationFact>(
  notifications: T[],
  viewerId?: string | null,
): T[] {
  const slotByFact = new Map<string, number>();
  const kept: T[] = [];

  for (const notification of notifications) {
    const key = notificationFactKey(notification);
    const slot = slotByFact.get(key);

    if (slot === undefined) {
      slotByFact.set(key, kept.length);
      kept.push(notification);
      continue;
    }

    if (representativeRank(notification, viewerId) > representativeRank(kept[slot], viewerId)) {
      kept[slot] = notification;
    }
  }

  return kept;
}

/**
 * How many rows to read before collapsing, wherever a list of alerts is shown.
 * It has to be larger than the list itself, because the copies of one fact sit
 * next to each other in the ordering and would otherwise fill it.
 *
 * How many copies that is has no ceiling. It was once the recipient count -
 * the managers plus an assignee - but a thread collects an alert per inbound
 * text and keeps them until it is closed, so one busy urgent thread can spend
 * the whole scan on itself and push other facts behind the "more in Command
 * Center" row. The screen stays honest either way, because that row is the
 * difference between the badge and the list rather than a silent shortfall.
 * The bound that would fix it belongs on the write side, where an answered
 * thread should stop holding an alert per text, and is filed separately for the
 * reason in
 * content/decisions/2026-08-19-thread-alerts-keep-the-text-that-raised-them.md.
 */
export const notificationScanLimit = 60;

/**
 * How many rows the Command Center reads. The sidebar rail sends whatever it
 * could not fit to that page, so the page has to reach further than the rail
 * does - a "12 more in Command Center" that lands on a shorter list than the
 * sidebar it came from is the dead end this exists to remove.
 */
export const notificationPageScanLimit = notificationScanLimit * 5;

/**
 * An alert stands until the work behind it is done: being resolved is the only
 * thing that retires one, and nothing in the app marks an alert read. The rail
 * counted the unread rows while listing everything not resolved, so its number
 * and the list it labels were free to describe different sets. One clause now
 * answers both.
 */
export const activeNotificationWhere = {
  status: { not: NotificationStatus.RESOLVED },
} satisfies Prisma.NotificationWhereInput;

/**
 * The alerts a staff member may read: a manager sees the dealership's, and
 * anyone else sees the ones addressed to her plus the ones raised against her
 * department. A reader with no department gets only her own.
 *
 * Decided once, because the lists ask for it as a Prisma clause and the badge
 * asks for it as SQL. Two surfaces working this out separately is how one of
 * them ends up handing a departmentless reader the whole dealership.
 */
type ReaderScope =
  | { everything: true }
  | { everything: false; recipientUserId: string; department: string | null };

function readerScope(user: AppUser): ReaderScope {
  if (canSeeAll(user)) {
    return { everything: true };
  }

  return { everything: false, recipientUserId: user.id, department: user.department };
}

/**
 * That scope as a Prisma clause - never an empty one for a reader who is not a
 * manager, which Prisma reads as "match everything".
 */
export function notificationScopeWhere(user: AppUser): Prisma.NotificationWhereInput {
  const scope = readerScope(user);

  if (scope.everything) {
    return {};
  }

  const orFilters: Prisma.NotificationWhereInput[] = [{ recipientUserId: scope.recipientUserId }];

  if (scope.department) {
    orFilters.push({ department: scope.department as Department });
  }

  return { OR: orFilters };
}

/** The alerts standing against this staff member right now - the set the rail lists and its badge counts. */
export function activeNotificationsWhere(user: AppUser): Prisma.NotificationWhereInput {
  return { AND: [notificationScopeWhere(user), activeNotificationWhere] };
}

/**
 * The badge's question, asked so the database answers it with a number.
 *
 * The alternative is reading back a row per stored copy and collapsing them
 * here, and the rows are not bounded by anything the reader can see: a thread
 * holds an alert per inbound text until it is closed, and this runs on every
 * page load. So the same fact key is counted distinct in SQL, over the same
 * rows `activeNotificationsWhere` describes.
 */
export function notificationFactCountQuery(user: AppUser, type?: string): Prisma.Sql {
  const scope = readerScope(user);
  const conditions: Prisma.Sql[] = [Prisma.sql`"status"::text <> ${NotificationStatus.RESOLVED}`];

  if (!scope.everything) {
    conditions.push(
      scope.department
        ? Prisma.sql`("recipientUserId" = ${scope.recipientUserId} OR "department"::text = ${scope.department})`
        : Prisma.sql`"recipientUserId" = ${scope.recipientUserId}`,
    );
  }

  if (type) {
    conditions.push(Prisma.sql`"type"::text = ${type}`);
  }

  return Prisma.sql`
    SELECT COUNT(DISTINCT ${notificationFactKeySql}) AS count
    FROM "Notification"
    WHERE ${Prisma.join(conditions, " AND ")}
  `;
}
