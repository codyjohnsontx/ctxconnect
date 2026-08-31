/**
 * Who may open a conversation. The list query, the server-side guard and the
 * controls panel all have to agree: routing a thread to another department is a
 * normal part of an advisor's day, and the panel that does it needs to know, in
 * advance, that the save will take the thread out of her reach.
 *
 * The same rule answers the other side of that question - which of a customer's
 * threads are out of the reader's reach - so a page that lists customers can
 * link to one she can open and still say where the rest of them went.
 *
 * Kept free of the database client so the rule can be tested directly and read
 * by a client component. The enum comes from the generated `enums` module
 * rather than `client`, which drags the Prisma runtime into the browser bundle
 * and fails to build.
 */

import { type Department, type Prisma } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import type { AppUser } from "@/lib/data";
import { labelize } from "@/lib/utils";

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

/**
 * The departments holding this customer's threads that the reader cannot open,
 * newest first and each named once. A customer can be worked by more than one
 * department at a time, and the reader only ever sees her own side of that.
 */
export function unreachableDepartments(
  user: AppUser,
  conversations: Array<{ assignedUserId: string | null; department: string }>,
) {
  const out: string[] = [];

  for (const conversation of conversations) {
    if (!conversation.department || canAccessConversation(user, conversation)) {
      continue;
    }

    if (!out.includes(conversation.department)) {
      out.push(conversation.department);
    }
  }

  return out;
}

/**
 * Wording for those departments. Names the department and nothing else - the
 * reader is not allowed to read that thread, so its status, its assignee and
 * anything said in it stay out of this line.
 */
export function describeOtherDepartments(departments: string[]) {
  const named = departments.map(labelize);

  if (named.length === 0) {
    return null;
  }

  if (named.length === 1) {
    return `Also with ${named[0]}`;
  }

  return `Also with ${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}
