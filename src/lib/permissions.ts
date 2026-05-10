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

  const orFilters: Prisma.TaskWhereInput[] = [{ assignedUserId: user.id }];

  if (user.department) {
    orFilters.push({ department: user.department as Department });
  }

  return {
    OR: orFilters,
  };
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

  if (isManagerOrAdmin(user)) {
    return conversation;
  }

  const accessFilters: Prisma.ConversationWhereInput[] = [{ assignedUserId: user.id }];

  if (user.department) {
    accessFilters.push({ department: user.department as Department });
  }

  const hasAccess = accessFilters.some((filter) => {
    if ("assignedUserId" in filter) {
      return conversation.assignedUserId === filter.assignedUserId;
    }

    if ("department" in filter) {
      return conversation.department === filter.department;
    }

    return false;
  });

  if (!hasAccess) {
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
