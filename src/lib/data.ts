import { startOfDay, endOfDay, subDays } from "date-fns";
import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  NotificationStatus,
  NotificationType,
  type Prisma,
  Priority,
  ProductEventType,
  Role,
  TaskStatus,
} from "@/generated/prisma/client";
import { getIntegrationHealth } from "@/lib/env";
import { notificationHref, syncOperationalNotifications } from "@/lib/notifications";
import { scopedTaskWhere } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export type AppUser = {
  id: string;
  role: string;
  department: string | null;
};

export type InboxFilters = {
  department?: string;
  status?: string;
  assigned?: string;
  unread?: string;
  priority?: string;
  tag?: string;
  failed?: string;
  needsAction?: string;
};

export const commandCenterFocuses = [
  "unread",
  "waitingOnStaff",
  "dueToday",
  "overdue",
  "unassigned",
  "failedMessages",
  "slaMissed",
  "hotSalesLeads",
  "serviceWaiting",
  "bikesReady",
] as const;

export type CommandCenterFocus = (typeof commandCenterFocuses)[number];

const activeTaskWhere = {
  status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS] },
} satisfies Prisma.TaskWhereInput;

const dealershipSettingsSelect = {
  id: true,
  dealershipName: true,
  salesPhone: true,
  servicePhone: true,
  partsPhone: true,
  websiteUrl: true,
} satisfies Prisma.DealershipSettingsSelect;

export function canSeeAll(user: AppUser) {
  return user.role === Role.ADMIN || user.role === Role.MANAGER;
}

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

async function getOrCreateDealershipSettings() {
  return prisma.dealershipSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      dealershipName: "CTX MotoWorks",
    },
    select: dealershipSettingsSelect,
  });
}

function filterWhere(filters: InboxFilters): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = {};

  if (filters.department) {
    where.department = filters.department as Department;
  }

  if (filters.status) {
    where.status = filters.status as ConversationStatus;
  }

  if (filters.assigned === "unassigned") {
    where.assignedUserId = null;
  } else if (filters.assigned) {
    where.assignedUserId = filters.assigned;
  }

  if (filters.unread === "true") {
    where.unread = true;
  }

  if (filters.priority) {
    where.priority = filters.priority as Priority;
  }

  if (filters.tag) {
    where.tags = { some: { tagId: filters.tag } };
  }

  if (filters.failed === "true") {
    where.messages = { some: { deliveryStatus: DeliveryStatus.FAILED } };
  }

  if (filters.needsAction === "true") {
    where.OR = [
      { unread: true },
      { status: { in: [ConversationStatus.WAITING_ON_STAFF, ConversationStatus.FOLLOW_UP_NEEDED] } },
      { assignedUserId: null },
      { messages: { some: { deliveryStatus: DeliveryStatus.FAILED } } },
      { tasks: { some: activeTaskWhere } },
    ];
  }

  return where;
}

export async function getInboxData(user: AppUser, filters: InboxFilters, selectedId?: string) {
  const where = {
    AND: [scopedConversationWhere(user), filterWhere(filters)],
  } satisfies Prisma.ConversationWhereInput;

  const [conversations, selectedConversation, users, tags, templates, dealershipSettings] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: [{ unread: "desc" }, { lastMessageAt: "desc" }],
      include: {
        customer: true,
        assignedUser: true,
        tags: { include: { tag: true } },
        tasks: { where: activeTaskWhere, orderBy: { dueDate: "asc" } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    selectedId
      ? prisma.conversation.findFirst({
          where: {
            AND: [scopedConversationWhere(user), { id: selectedId }],
          },
          include: {
            customer: {
              include: {
                vehicles: true,
                conversations: {
                  orderBy: { lastMessageAt: "desc" },
                  take: 6,
                },
              },
            },
            assignedUser: true,
            tags: { include: { tag: true } },
            tasks: {
              where: activeTaskWhere,
              orderBy: { dueDate: "asc" },
              include: { assignedUser: true },
            },
            messages: {
              orderBy: { createdAt: "asc" },
              include: { sender: true },
            },
            aiInsights: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        })
      : null,
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
    prisma.template.findMany({
      where: { active: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    }),
    getOrCreateDealershipSettings(),
  ]);

  return { conversations, selectedConversation, users, tags, templates, dealershipSettings };
}

function isCommandCenterFocus(value?: string): value is CommandCenterFocus {
  return commandCenterFocuses.includes(value as CommandCenterFocus);
}

async function getCommandCenterFocusItems(
  user: AppUser,
  focus: CommandCenterFocus | undefined,
  todayStart: Date,
  todayEnd: Date,
  notificationScope: Prisma.NotificationWhereInput,
) {
  if (!focus) {
    return [];
  }

  const scope = scopedConversationWhere(user);
  const conversationInclude = {
    customer: true,
    assignedUser: true,
    tags: { include: { tag: true } },
  } satisfies Prisma.ConversationInclude;

  const conversationToItem = (conversation: {
    id: string;
    customer: { name: string };
    assignedUser: { name: string } | null;
    department: Department;
    status: ConversationStatus;
    priority: Priority;
    tags: { tag: { name: string } }[];
  }) => ({
    id: conversation.id,
    kind: "conversation" as const,
    title: conversation.customer.name,
    description: `${labelDepartment(conversation.department)} conversation`,
    meta: `${labelStatus(conversation.status)} · ${conversation.assignedUser?.name ?? "Unassigned"}`,
    href: `/inbox/${conversation.id}`,
    badges: [
      conversation.priority !== Priority.NORMAL ? labelStatus(conversation.priority) : null,
      ...conversation.tags.map(({ tag }) => tag.name),
    ].filter(Boolean) as string[],
  });

  switch (focus) {
    case "unread":
    case "waitingOnStaff":
    case "unassigned":
    case "hotSalesLeads":
    case "serviceWaiting":
    case "bikesReady": {
      const whereByFocus: Record<typeof focus, Prisma.ConversationWhereInput> = {
        unread: { unread: true },
        waitingOnStaff: { status: ConversationStatus.WAITING_ON_STAFF },
        unassigned: { assignedUserId: null },
        hotSalesLeads: {
          department: Department.SALES,
          tags: { some: { tag: { name: "Hot lead" } } },
          status: { not: ConversationStatus.CLOSED },
        },
        serviceWaiting: {
          department: Department.SERVICE,
          status: { in: [ConversationStatus.WAITING_ON_STAFF, ConversationStatus.FOLLOW_UP_NEEDED] },
        },
        bikesReady: { tags: { some: { tag: { name: "Pickup ready" } } } },
      };
      const conversations = await prisma.conversation.findMany({
        where: { AND: [scope, whereByFocus[focus]] },
        orderBy: [{ priority: "desc" }, { lastMessageAt: "desc" }],
        take: 25,
        include: conversationInclude,
      });

      return conversations.map(conversationToItem);
    }
    case "dueToday":
    case "overdue": {
      const taskScope = scopedTaskWhere(user);
      const tasks = await prisma.task.findMany({
        where: {
          AND: [
            activeTaskWhere,
            taskScope,
            focus === "dueToday"
              ? { dueDate: { gte: todayStart, lte: todayEnd } }
              : { dueDate: { lt: todayStart } },
          ],
        },
        orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
        take: 25,
        include: {
          customer: true,
          assignedUser: true,
          conversation: true,
        },
      });

      return tasks.map((task) => ({
        id: task.id,
        kind: "task" as const,
        title: task.title,
        description: task.customer.name,
        meta: `${labelDepartment(task.department)} · ${task.assignedUser?.name ?? "Unassigned"} · due ${task.dueDate.toLocaleString()}`,
        href: task.conversationId ? `/inbox/${task.conversationId}` : "/tasks",
        badges: [labelStatus(task.priority), labelStatus(task.status)],
      }));
    }
    case "failedMessages": {
      const messages = await prisma.message.findMany({
        where: {
          deliveryStatus: DeliveryStatus.FAILED,
          conversation: scope,
        },
        orderBy: { updatedAt: "desc" },
        take: 25,
        include: {
          conversation: {
            include: {
              customer: true,
              assignedUser: true,
            },
          },
        },
      });

      return messages.map((message) => ({
        id: message.id,
        kind: "message" as const,
        title: message.conversation.customer.name,
        description: message.errorMessage ?? "Outgoing message failed.",
        meta: `${labelDepartment(message.conversation.department)} · ${message.conversation.assignedUser?.name ?? "Unassigned"}`,
        href: `/inbox/${message.conversationId}`,
        badges: ["Failed SMS"],
      }));
    }
    case "slaMissed": {
      const notifications = await prisma.notification.findMany({
        where: {
          AND: [
            notificationScope,
            {
              type: NotificationType.SLA_MISSED,
              status: { not: NotificationStatus.RESOLVED },
            },
          ],
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 25,
        include: {
          conversation: { include: { customer: true, assignedUser: true } },
          task: { include: { customer: true } },
        },
      });

      return notifications.map((notification) => ({
        id: notification.id,
        kind: "notification" as const,
        title: notification.title,
        description:
          notification.body ??
          notification.conversation?.customer.name ??
          notification.task?.customer.name ??
          "SLA notification",
        meta: `${notification.department ? labelDepartment(notification.department) : "General"} · ${notification.conversation?.assignedUser?.name ?? "Unassigned"}`,
        href: notificationHref(notification),
        badges: [labelStatus(notification.priority), "SLA missed"],
      }));
    }
  }
}

function labelStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labelDepartment(value: Department) {
  return labelStatus(value);
}

export type AiOpsAnalytics = {
  generatedCount: number;
  acceptedCount: number;
  dismissedCount: number;
  copiedReplyCount: number;
  followUpCreatedCount: number;
  noteCreatedCount: number;
  acceptanceRate: number | null;
  highRiskInsightCount: number;
  latestHighRiskInsights: Array<{
    id: string;
    conversationId: string;
    customerName: string;
    riskLevel: Priority;
    summary: string;
    suggestedNextAction: string;
    createdAt: Date;
  }>;
};

export async function getAiOpsAnalytics(user: AppUser, windowDays = 14): Promise<AiOpsAnalytics> {
  const scope = scopedConversationWhere(user);
  const windowStart = subDays(new Date(), windowDays);
  const eventScope = {
    createdAt: { gte: windowStart },
    conversation: { is: scope },
  } satisfies Prisma.ProductEventWhereInput;
  const insightScope = {
    createdAt: { gte: windowStart },
    conversation: scope,
  } satisfies Prisma.ConversationAiInsightWhereInput;

  const [
    generatedCount,
    acceptedCount,
    dismissedCount,
    copiedReplyCount,
    followUpCreatedCount,
    noteCreatedCount,
    highRiskInsightCount,
    latestHighRiskInsights,
  ] = await Promise.all([
    prisma.productEvent.count({
      where: { ...eventScope, type: ProductEventType.AI_INSIGHT_GENERATED },
    }),
    prisma.productEvent.count({
      where: { ...eventScope, type: ProductEventType.AI_RECOMMENDATION_ACCEPTED },
    }),
    prisma.productEvent.count({
      where: { ...eventScope, type: ProductEventType.AI_RECOMMENDATION_DISMISSED },
    }),
    prisma.productEvent.count({
      where: { ...eventScope, type: ProductEventType.AI_REPLY_COPIED },
    }),
    prisma.productEvent.count({
      where: { ...eventScope, type: ProductEventType.AI_FOLLOW_UP_CREATED },
    }),
    prisma.productEvent.count({
      where: { ...eventScope, type: ProductEventType.AI_NOTE_CREATED },
    }),
    prisma.conversationAiInsight.count({
      where: {
        ...insightScope,
        riskLevel: { in: [Priority.HIGH, Priority.URGENT] },
      },
    }),
    prisma.conversationAiInsight.findMany({
      where: {
        ...insightScope,
        riskLevel: { in: [Priority.HIGH, Priority.URGENT] },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        conversation: {
          include: {
            customer: true,
          },
        },
      },
    }),
  ]);

  return {
    generatedCount,
    acceptedCount,
    dismissedCount,
    copiedReplyCount,
    followUpCreatedCount,
    noteCreatedCount,
    acceptanceRate: generatedCount > 0 ? Math.round((acceptedCount / generatedCount) * 100) : null,
    highRiskInsightCount,
    latestHighRiskInsights: latestHighRiskInsights.map((insight) => ({
      id: insight.id,
      conversationId: insight.conversationId,
      customerName: insight.conversation.customer.name,
      riskLevel: insight.riskLevel,
      summary: insight.summary,
      suggestedNextAction: insight.suggestedNextAction,
      createdAt: insight.createdAt,
    })),
  };
}

export async function getCommandCenterData(user: AppUser, focusParam?: string) {
  await syncOperationalNotifications();

  const scope = scopedConversationWhere(user);
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const responseWindowStart = subDays(todayStart, 14);
  const selectedFocus = isCommandCenterFocus(focusParam) ? focusParam : undefined;
  const userCanSeeAll = canSeeAll(user);
  const taskScope = scopedTaskWhere(user);
  const notificationScope: Prisma.NotificationWhereInput = userCanSeeAll
    ? {}
    : {
        OR: [
          { recipientUserId: user.id },
          ...(user.department ? [{ department: user.department as Department }] : []),
        ],
      };

  const [
    unread,
    waitingOnStaff,
    unassigned,
    failedMessages,
    slaMissed,
    hotSalesLeads,
    serviceWaiting,
    bikesReady,
    dueToday,
    overdue,
    visibleConversations,
    latestNotifications,
    focusItems,
    needsAction,
    users,
    volume,
    responseMessages,
    aiOpsAnalytics,
  ] = await Promise.all([
    prisma.conversation.count({ where: { AND: [scope, { unread: true }] } }),
    prisma.conversation.count({
      where: { AND: [scope, { status: ConversationStatus.WAITING_ON_STAFF }] },
    }),
    prisma.conversation.count({ where: { AND: [scope, { assignedUserId: null }] } }),
    prisma.message.count({
      where: {
        deliveryStatus: DeliveryStatus.FAILED,
        conversation: scope,
      },
    }),
    prisma.notification.count({
      where: {
        AND: [notificationScope, { type: NotificationType.SLA_MISSED, status: { not: NotificationStatus.RESOLVED } }],
      },
    }),
    prisma.conversation.count({
      where: {
        AND: [
          scope,
          {
            department: Department.SALES,
            tags: { some: { tag: { name: "Hot lead" } } },
            status: { not: ConversationStatus.CLOSED },
          },
        ],
      },
    }),
    prisma.conversation.count({
      where: {
        AND: [
          scope,
          {
            department: Department.SERVICE,
            status: { in: [ConversationStatus.WAITING_ON_STAFF, ConversationStatus.FOLLOW_UP_NEEDED] },
          },
        ],
      },
    }),
    prisma.conversation.count({
      where: { AND: [scope, { tags: { some: { tag: { name: "Pickup ready" } } } }] },
    }),
    prisma.task.count({
      where: {
        AND: [activeTaskWhere, taskScope, { dueDate: { gte: todayStart, lte: todayEnd } }],
      },
    }),
    prisma.task.count({
      where: {
        AND: [activeTaskWhere, taskScope, { dueDate: { lt: todayStart } }],
      },
    }),
    prisma.conversation.findMany({
      where: scope,
      orderBy: { lastMessageAt: "desc" },
      take: 8,
      include: {
        customer: true,
        assignedUser: true,
        tags: { include: { tag: true } },
      },
    }),
    prisma.notification.findMany({
      where: {
        AND: [notificationScope, { status: { not: NotificationStatus.RESOLVED } }],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 12,
      include: {
        conversation: { include: { customer: true, assignedUser: true } },
        task: { include: { customer: true, assignedUser: true } },
      },
    }),
    getCommandCenterFocusItems(user, selectedFocus, todayStart, todayEnd, notificationScope),
    prisma.conversation.findMany({
      where: {
        AND: [
          scope,
          {
            OR: [
              { unread: true },
              { assignedUserId: null },
              { status: { in: [ConversationStatus.WAITING_ON_STAFF, ConversationStatus.FOLLOW_UP_NEEDED] } },
              { messages: { some: { deliveryStatus: DeliveryStatus.FAILED } } },
              { tasks: { some: activeTaskWhere } },
            ],
          },
        ],
      },
      orderBy: [{ unread: "desc" }, { priority: "desc" }, { lastMessageAt: "desc" }],
      take: 10,
      include: {
        customer: true,
        assignedUser: true,
        tags: { include: { tag: true } },
        tasks: { where: activeTaskWhere, orderBy: { dueDate: "asc" } },
        messages: {
          where: { deliveryStatus: DeliveryStatus.FAILED },
          take: 1,
        },
      },
    }),
    prisma.user.findMany({
      where: userCanSeeAll
        ? { active: true }
        : {
            id: user.id,
            active: true,
          },
      orderBy: { name: "asc" },
      include: {
        assignedConversations: {
          where: { status: { not: ConversationStatus.CLOSED } },
          include: {
            messages: { where: { deliveryStatus: DeliveryStatus.FAILED }, take: 1 },
          },
        },
        assignedTasks: {
          where: { status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS] } },
        },
        notifications: {
          where: { status: { not: NotificationStatus.RESOLVED } },
        },
      },
    }),
    prisma.message.count({
      where: {
        createdAt: { gte: todayStart, lte: todayEnd },
        conversation: scope,
      },
    }),
    prisma.conversation.findMany({
      where: {
        AND: [
          scope,
          {
            lastMessageAt: { gte: responseWindowStart },
            messages: {
              some: {
                direction: { in: [MessageDirection.INBOUND, MessageDirection.OUTBOUND] },
                createdAt: { gte: responseWindowStart },
              },
            },
          },
        ],
      },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
      select: {
        messages: {
          where: {
            direction: { in: [MessageDirection.INBOUND, MessageDirection.OUTBOUND] },
            createdAt: { gte: responseWindowStart },
          },
          orderBy: { createdAt: "asc" },
          select: {
            direction: true,
            createdAt: true,
          },
        },
      },
    }),
    getAiOpsAnalytics(user),
  ]);

  const responseTimesMs: number[] = [];

  for (const conversation of responseMessages) {
    let pendingInboundAt: Date | null = null;

    for (const message of conversation.messages) {
      if (message.direction === MessageDirection.INBOUND) {
        pendingInboundAt = message.createdAt;
        continue;
      }

      if (message.direction === MessageDirection.OUTBOUND && pendingInboundAt) {
        responseTimesMs.push(message.createdAt.getTime() - pendingInboundAt.getTime());
        pendingInboundAt = null;
      }
    }
  }

  const averageResponseMs =
    responseTimesMs.length > 0
      ? Math.round(responseTimesMs.reduce((sum, value) => sum + value, 0) / responseTimesMs.length)
      : null;

  const averageResponseTime =
    averageResponseMs === null
      ? "No replies yet"
      : averageResponseMs < 60_000
        ? "<1m"
        : `${Math.round(averageResponseMs / 60_000)}m`;

  return {
    metrics: {
      unread,
      waitingOnStaff,
      dueToday,
      overdue,
      unassigned,
      failedMessages,
      slaMissed,
      hotSalesLeads,
      serviceWaiting,
      bikesReady,
      averageResponseTime,
      messageVolume: volume,
    },
    responseHealth: {
      averageResponseTime,
      repliedInboundCount: responseTimesMs.length,
      definition: "Average time from a visible inbound customer SMS to the next outbound staff reply over the last 14 days.",
    },
    visibleConversations,
    latestNotifications: latestNotifications.map((notification) => ({
      ...notification,
      href: notificationHref(notification),
    })),
    selectedFocus,
    focusItems,
    needsAction,
    employeeStats: users.map((employee) => ({
      id: employee.id,
      name: employee.name,
      role: employee.role,
      department: employee.department,
      assignedConversations: employee.assignedConversations.length,
      failedMessages: employee.assignedConversations.filter(
        (conversation) => conversation.messages.length > 0,
      ).length,
      openFollowUps: employee.assignedTasks.length,
      overdueFollowUps: employee.assignedTasks.filter((task) => task.dueDate < todayStart).length,
      activeNotifications: employee.notifications.length,
    })),
    aiOpsAnalytics,
  };
}

export async function getShellData(user: AppUser) {
  const scope = scopedConversationWhere(user);
  const userCanSeeAll = canSeeAll(user);
  const notificationScope: Prisma.NotificationWhereInput = userCanSeeAll
    ? {}
    : {
        OR: [
          { recipientUserId: user.id },
          ...(user.department ? [{ department: user.department as Department }] : []),
        ],
      };

  const [inboxCount, taskCount, commandCount, latestNotifications] = await Promise.all([
    prisma.conversation.count({
      where: {
        AND: [
          scope,
          {
            OR: [
              { unread: true },
              { assignedUserId: null },
              { messages: { some: { deliveryStatus: DeliveryStatus.FAILED } } },
            ],
          },
        ],
      },
    }),
    prisma.task.count({
	      where: userCanSeeAll
	        ? activeTaskWhere
	        : {
	            AND: [
	              activeTaskWhere,
	              {
	                OR: [
	                  { assignedUserId: user.id },
	                  ...(user.department ? [{ department: user.department as Department }] : []),
	                ],
	              },
	            ],
	          },
    }),
    prisma.notification.count({
      where: {
        AND: [notificationScope, { status: NotificationStatus.UNREAD }],
      },
    }),
    prisma.notification.findMany({
      where: {
        AND: [notificationScope, { status: { not: NotificationStatus.RESOLVED } }],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 5,
      include: {
        conversation: { include: { customer: true } },
        task: { include: { customer: true } },
      },
    }),
  ]);

  return {
    counts: {
      inbox: inboxCount,
      tasks: taskCount,
      command: commandCount,
    },
    latestNotifications: latestNotifications.map((notification) => ({
      ...notification,
      href: notificationHref(notification),
    })),
  };
}

export async function getCustomers(user: AppUser) {
  return prisma.customer.findMany({
    where: canSeeAll(user)
      ? {}
      : {
          conversations: {
            some: scopedConversationWhere(user),
          },
        },
    orderBy: { updatedAt: "desc" },
    include: {
      vehicles: true,
      conversations: {
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        include: { assignedUser: true },
      },
    },
  });
}

export async function getTasks(user: AppUser) {
  return prisma.task.findMany({
    where: scopedTaskWhere(user),
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    include: {
      customer: true,
      conversation: true,
      assignedUser: true,
    },
  });
}

export async function getTemplates() {
  return prisma.template.findMany({
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });
}

export async function getSettingsData() {
  const [users, dealershipSettings, health] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    getOrCreateDealershipSettings(),
    getIntegrationHealth(),
  ]);

  return {
    users,
    dealershipSettings,
    health,
  };
}
