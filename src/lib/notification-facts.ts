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
 * listed or counted. They take plain objects and never touch the database, so
 * the alert rail, the Command Center and their counters share one rule.
 *
 * What makes two rows one fact is the thread they are about, not the message
 * that raised them. A thread with no owner is one thing to do however many
 * texts have arrived on it, and so is a thread with unanswered customer
 * messages. The single exception is a text that failed to send: two failed
 * texts on one thread are two things to fix, so those keep the message.
 */

import type { Department, Prisma } from "@/generated/prisma/client";
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

// A follow-up that is due today and one that is already late are the same
// follow-up. The operational sweep raises the overdue row when the clock
// passes the due date and only withdraws the "due today" row the next time it
// runs, so the two have to read as one alert in between or the advisor is
// told a follow-up is both still coming and already late.
const followUpTypes: string[] = [NotificationType.FOLLOW_UP_DUE, NotificationType.FOLLOW_UP_OVERDUE];

// The alerts whose fact really is one message rather than the thread: two
// texts that failed to send on one thread are two things to fix and must not
// collapse into one. Every other alert describes the thread itself - it has no
// owner, it has an unanswered customer message, it missed its SLA - so the
// message it happened to be raised from stays out of the key. Writers disagree
// about whether they attach one at all, and keying on it splits one unowned
// thread into two alerts and one busy thread into an alert per text.
const perMessageTypes: string[] = [NotificationType.MESSAGE_FAILED];

export function notificationFactKey(notification: NotificationFact): string {
  const subject = followUpTypes.includes(notification.type) ? "FOLLOW_UP" : notification.type;
  const message = perMessageTypes.includes(notification.type) ? (notification.messageId ?? "") : "";

  return [subject, notification.conversationId ?? "", notification.taskId ?? "", message].join(" ");
}

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
 * department. A reader with no department gets only her own - never an empty
 * clause, which Prisma reads as "match everything" and would hand her the
 * whole dealership's alerts.
 */
export function notificationScopeWhere(user: AppUser): Prisma.NotificationWhereInput {
  if (canSeeAll(user)) {
    return {};
  }

  const orFilters: Prisma.NotificationWhereInput[] = [{ recipientUserId: user.id }];

  if (user.department) {
    orFilters.push({ department: user.department as Department });
  }

  return { OR: orFilters };
}

/** The alerts standing against this staff member right now - the set the rail lists and its badge counts. */
export function activeNotificationsWhere(user: AppUser): Prisma.NotificationWhereInput {
  return { AND: [notificationScopeWhere(user), activeNotificationWhere] };
}
