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
 */

import { NotificationType } from "@/generated/prisma/enums";

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

export function notificationFactKey(notification: NotificationFact): string {
  const subject = followUpTypes.includes(notification.type) ? "FOLLOW_UP" : notification.type;

  return [
    subject,
    notification.conversationId ?? "",
    notification.taskId ?? "",
    notification.messageId ?? "",
  ].join(" ");
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
