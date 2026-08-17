/**
 * Who may open a conversation. The list query, the server-side guard and the
 * controls panel all have to agree: routing a thread to another department is a
 * normal part of an advisor's day, and the panel that does it needs to know, in
 * advance, that the save will take the thread out of her reach.
 *
 * Kept free of the database client so the rule can be tested directly and read
 * by a client component. The enum comes from the generated `enums` module
 * rather than `client`, which drags the Prisma runtime into the browser bundle
 * and fails to build.
 */

import { type Department, type Prisma } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import type { AppUser } from "@/lib/data";

export function canSeeAll(user: AppUser) {
  return user.role === Role.ADMIN || user.role === Role.MANAGER;
}

/** The conversations this staff member is allowed to read. */
export function scopedConversationWhere(user: AppUser): Prisma.ConversationWhereInput {
  if (canSeeAll(user)) {
    return {};
  }

  const orFilters: Prisma.ConversationWhereInput[] = [{ assignedUserId: user.id }];

  if (user.department) {
    orFilters.push({ department: user.department as Department });
  }

  return {
    OR: orFilters,
  };
}

/** Whether this staff member may read and act on that conversation. */
export function canAccessConversation(
  user: AppUser,
  conversation: { assignedUserId: string | null; department: string },
) {
  if (canSeeAll(user)) {
    return true;
  }

  if (conversation.assignedUserId === user.id) {
    return true;
  }

  return Boolean(user.department) && conversation.department === user.department;
}
