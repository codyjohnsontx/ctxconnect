import { startOfDay, endOfDay } from "date-fns";
import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  NotificationStatus,
  NotificationType,
  type Prisma,
  Priority,
  Role,
  TaskStatus,
} from "@/generated/prisma/client";
import { notificationHref, syncOperationalNotifications } from "@/lib/notifications";
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

export function canSeeAll(user: AppUser) {
  return user.role === Role.ADMIN || user.role === Role.MANAGER;
}

export function scopedConversationWhere(user: AppUser): Prisma.ConversationWhereInput {
  if (canSeeAll(user)) {
    return {};
  }

  return {
    OR: [
      { assignedUserId: user.id },
      user.department ? { department: user.department as Department } : {},
    ],
  };
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

  const [conversations, selectedConversation, users, tags, templates] = await Promise.all([
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
  ]);

  return { conversations, selectedConversation, users, tags, templates };
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
      const tasks = await prisma.task.findMany({
        where: {
          AND: [
            activeTaskWhere,
            focus === "dueToday"
              ? { dueDate: { gte: todayStart, lte: todayEnd } }
              : { dueDate: { lt: todayStart } },
            canSeeAll(user)
              ? {}
              : {
                  OR: [
                    { assignedUserId: user.id },
                    user.department ? { department: user.department as Department } : {},
                  ],
                },
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

export async function getCommandCenterData(user: AppUser, focusParam?: string) {
  await syncOperationalNotifications();

  const scope = scopedConversationWhere(user);
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const selectedFocus = isCommandCenterFocus(focusParam) ? focusParam : undefined;
  const userCanSeeAll = canSeeAll(user);
  const notificationScope: Prisma.NotificationWhereInput = userCanSeeAll
    ? {}
    : {
        OR: [
          { recipientUserId: user.id },
          user.department ? { department: user.department as Department } : {},
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
        status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS] },
        dueDate: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.task.count({
      where: {
        status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS] },
        dueDate: { lt: todayStart },
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
      where: { active: true },
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
      },
    }),
  ]);

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
      averageResponseTime: "18m",
      messageVolume: volume,
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
          user.department ? { department: user.department as Department } : {},
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
                  user.department ? { department: user.department as Department } : {},
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
    where: canSeeAll(user)
      ? {}
      : {
          OR: [
            { assignedUserId: user.id },
            user.department ? { department: user.department as Department } : {},
          ],
        },
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
  return prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}
