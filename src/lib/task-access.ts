/**
 * Who may see and move a follow-up along. The list query and the buttons that
 * finish or reschedule one have to agree: a follow-up an advisor can read on
 * her queue is one she can also act on, and a surface that offers her a button
 * the write would refuse turns a click into an error page.
 *
 * Kept free of the database client so both halves of that rule can be tested
 * directly and read by a client component, the same way conversation-access.ts
 * holds the matching rule for threads. The enum comes from the generated
 * `enums` module rather than `client`, which drags the Prisma runtime into the
 * browser bundle and fails to build.
 */

import { type Department, type Prisma } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import type { AppUser } from "@/lib/data";

export function isManagerOrAdmin(user: AppUser) {
  return user.role === Role.ADMIN || user.role === Role.MANAGER;
}

/** The follow-ups this staff member is allowed to read. */
export function scopedTaskWhere(user: AppUser): Prisma.TaskWhereInput {
  if (isManagerOrAdmin(user)) {
    return {};
  }

  const orFilters: Prisma.TaskWhereInput[] = [{ assignedUserId: user.id }];

  if (user.department) {
    orFilters.push({ department: user.department as Department });
  }

  return {
    OR: orFilters,
  };
}

/** Whether this staff member may move that follow-up along. */
export function canUpdateTask(
  user: AppUser,
  task: { assignedUserId: string | null; department: string },
) {
  if (isManagerOrAdmin(user)) {
    return true;
  }

  if (task.assignedUserId === user.id) {
    return true;
  }

  return Boolean(user.department) && task.department === user.department;
}
