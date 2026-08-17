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
 * listed or counted. They build clauses and keys but never open a connection,
 * so the alert rail, the Command Center and their counters share one rule and
 * it can be read without a database.
 *
 * What makes two rows one fact is the thread they are about, not the message
 * that raised them. A thread with no owner is one thing to do however many
 * texts have arrived on it, and so is a thread with unanswered customer
 * messages. The single exception is a text that failed to send: two failed
 * texts on one thread are two things to fix, so those keep the message.
 *
 * That rule is needed in two forms, because a list is collapsed after its rows
 * are read while a badge must be one number the database works out on its own.
 * Both forms are built here, from the same two lists, so nothing can teach one
 * of them a rule the other has not learned.
 */

import { type Department, Prisma } from "@/generated/prisma/client";
import { NotificationStatus, NotificationType } from "@/generated/prisma/enums";
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
export const followUpTypes: string[] = [
  NotificationType.FOLLOW_UP_DUE,
  NotificationType.FOLLOW_UP_OVERDUE,
];

// The alerts whose fact really is one message rather than the thread: two
// texts that failed to send on one thread are two things to fix and must not
// collapse into one. Every other alert describes the thread itself - it has no
// owner, it has an unanswered customer message, it missed its SLA - so the
// message it happened to be raised from stays out of the key. Writers disagree
// about whether they attach one at all, and keying on it splits one unowned
// thread into two alerts and one busy thread into an alert per text.
export const perMessageTypes: string[] = [NotificationType.MESSAGE_FAILED];

export function notificationFactKey(notification: NotificationFact): string {
  const subject = followUpTypes.includes(notification.type) ? followUpSubject : notification.type;
  const message = perMessageTypes.includes(notification.type) ? (notification.messageId ?? "") : "";

  return [subject, notification.conversationId ?? "", notification.taskId ?? "", message].join(" ");
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
 * thread should stop holding an alert per text, and that is filed separately.
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
