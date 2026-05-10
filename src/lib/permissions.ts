import { Role, type Department, type Prisma } from "@/generated/prisma/client";
import type { AppUser } from "@/lib/data";
import { prisma } from "@/lib/prisma";

export function isAdmin(user: AppUser) {
  return user.role === Role.ADMIN;
}

export function isManagerOrAdmin(user: AppUser) {
  return user.role === Role.ADMIN || user.role === Role.MANAGER;
}

export function requireAdmin(user: AppUser) {
  if (!isAdmin(user)) {
    throw new Error("Admin access required.");
  }
}

export function requireManagerOrAdmin(user: AppUser) {
  if (!isManagerOrAdmin(user)) {
    throw new Error("Manager or admin access required.");
  }
}

export function scopedTaskWhere(user: AppUser): Prisma.TaskWhereInput {
  if (isManagerOrAdmin(user)) {
    return {};
  }

  return {
    OR: [
      { assignedUserId: user.id },
      user.department ? { department: user.department as Department } : {},
    ],
  };
}

export async function requireConversationAccess(user: AppUser, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      ...(isManagerOrAdmin(user)
        ? {}
        : {
            OR: [
              { assignedUserId: user.id },
              user.department ? { department: user.department as Department } : {},
            ],
          }),
    },
    include: {
      customer: true,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found or access denied.");
  }

  return conversation;
}
