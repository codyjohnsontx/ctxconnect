import { Role, type Department, type Prisma } from "@/generated/prisma/client";
import type { AppUser } from "@/lib/data";
import { canAccessConversation } from "@/lib/conversation-access";
import { prisma } from "@/lib/prisma";
import { canUpdateTask, isManagerOrAdmin, scopedTaskWhere } from "@/lib/task-access";

// The conversation and follow-up access rules live in database-free modules so
// they can be tested directly and read by the panels that render in the
// browser; they stay exported from here so callers keep one place to ask about
// permissions.
export { canAccessConversation, canUpdateTask, isManagerOrAdmin, scopedTaskWhere };

export function isAdmin(user: AppUser) {
  return user.role === Role.ADMIN;
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

export async function requireConversationAccess(user: AppUser, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      customer: true,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  if (!canAccessConversation(user, conversation)) {
    throw new Error("Conversation access denied.");
  }

  return conversation;
}

export async function requireCustomerAccess(user: AppUser, customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });

  if (!customer) {
    throw new Error("Customer not found.");
  }

  if (isManagerOrAdmin(user)) {
    return customer;
  }

  const accessFilters: Prisma.ConversationWhereInput[] = [{ assignedUserId: user.id }];

  if (user.department) {
    accessFilters.push({ department: user.department as Department });
  }

  const scopedConversationCount = await prisma.conversation.count({
    where: {
      customerId,
      OR: accessFilters,
    },
  });

  if (scopedConversationCount === 0) {
    throw new Error("Customer access denied.");
  }

  return customer;
}
