import { startOfDay, endOfDay, subDays } from "date-fns";
import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  NotificationType,
  type Prisma,
  Priority,
  ProductEventType,
  TaskStatus,
} from "@/generated/prisma/client";
import { getQueueBriefCoverage } from "@/lib/ai/ambient-pass";
import { isAiOpsBriefConfigured } from "@/lib/ai/ops-brief";
import { rankConversationQueue } from "@/lib/ai/queue-rank";
import {
  canAccessConversation,
  canSeeAll,
  scopedConversationWhere,
  unreachableDepartments,
} from "@/lib/conversation-access";
import { coverageLandsOn, openConversationWhere } from "@/lib/coverage";
import { getIntegrationHealth } from "@/lib/env";
import {
  activeNotificationWhere,
  activeNotificationsWhere,
  dedupeNotificationFacts,
  notificationPageScanLimit,
  notificationScanLimit,
  notificationScopeWhere,
} from "@/lib/notification-facts";
import {
  countNotificationFacts,
  notificationHref,
  syncOperationalNotifications,
} from "@/lib/notifications";
import { endOfDealershipDay } from "@/lib/dealership-day";
import { scopedTaskWhere } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  conversationQueryWhere,
  escapeLikeWildcards,
  matchSnippet,
  normalizeSearchTerm,
} from "@/lib/search";

export type AppUser = {
  id: string;
  role: string;
  department: string | null;
};

export type InboxFilters = {
  q?: string;
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

// The conversation access rules live in a database-free module so they can be
// tested directly and read by the controls panel in the browser; they stay
// exported from here so callers keep one place to ask who sees what.
export { canAccessConversation, canSeeAll, scopedConversationWhere };

/** What the app holds for a dealership nobody has configured yet. */
const unconfiguredDealershipSettings = {
  id: "default",
  dealershipName: null,
  salesPhone: null,
  servicePhone: null,
  partsPhone: null,
  websiteUrl: null,
};

type DealershipSettingsView = Omit<
  Prisma.DealershipSettingsGetPayload<{ select: typeof dealershipSettingsSelect }>,
  "dealershipName"
> & {
  /** null until an admin has saved one on the settings page. */
  dealershipName: string | null;
};

// Read, never created: this used to upsert a row carrying the demo dealership's
// name for a dealership that had not chosen one, and `{{dealershipName}}` then
// filled with it as though someone had. Nothing needs the row to exist - the
// settings form upserts on save - so an absent one is reported as absent and
// the template asks for the name instead.
async function getDealershipSettings(): Promise<DealershipSettingsView> {
  const settings = await prisma.dealershipSettings.findUnique({
    where: { id: "default" },
    select: dealershipSettingsSelect,
  });

  return settings ?? unconfiguredDealershipSettings;
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
  const searchTerm = normalizeSearchTerm(filters.q);
  // Scope, filters and search, ANDed in one place - see conversationQueryWhere
  // for why the search must not join the filters' own OR.
  const where = conversationQueryWhere(
    scopedConversationWhere(user),
    filterWhere(filters),
    searchTerm,
  );

  const [
    conversations,
    newestReplies,
    selectedConversation,
    users,
    tags,
    templates,
    dealershipSettings,
    briefCoverage,
  ] = await Promise.all([
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
          // The row previews this message, and a staff reply or an internal
          // note reads as the customer's own words without a name on it. Only
          // the name: the full User row carries a password hash.
          include: { sender: { select: { name: true } } },
        },
        aiInsights: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    // The newest message staff sent in each of those conversations, which is a
    // different message from the one the row previews as soon as anyone writes
    // anything afterwards. The row's undelivered marker has to be asked of this
    // one - see hasUndeliveredReply - and the preview include above cannot also
    // carry it, because one relation can only be included once.
    prisma.message.findMany({
      where: { conversation: where, direction: MessageDirection.OUTBOUND },
      // `distinct` keeps the first row per conversation, so the conversation has
      // to lead the ordering for Postgres to answer this with DISTINCT ON.
      orderBy: [{ conversationId: "asc" }, { createdAt: "desc" }],
      distinct: ["conversationId"],
      select: { conversationId: true, direction: true, deliveryStatus: true },
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
    // Only the two fields the assignee pickers render. The full row carries a
    // password hash, and the pickers now live in a client component, so a
    // `select` here is what keeps hashes out of the page payload.
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
    prisma.template.findMany({
      where: { active: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    }),
    getDealershipSettings(),
    // Scoped like the pass itself rather than by the active filters, because
    // `Run pass` briefs everything this user can see, not just the rows in view.
    getQueueBriefCoverage(scopedConversationWhere(user)),
  ]);

  const newestReplyByConversation = new Map(newestReplies.map((reply) => [reply.conversationId, reply]));

  // The list query orders by recency; the AI pass decides what actually matters,
  // so the queue the advisor sees is ranked by its output. See queue-rank.ts.
  const rankedConversations = rankConversationQueue(conversations).map((conversation) => ({
    ...conversation,
    newestReply: newestReplyByConversation.get(conversation.id) ?? null,
  }));

  // A row can match on message text alone, and the preview shows the newest
  // message rather than the matching one. Without the matching line on the row,
  // that hit reads as a result the search invented. The relation is already
  // included once for the preview, so this is a second read rather than a
  // second `messages` include, and it only runs while she is searching. The
  // ids come from the scoped list above, so it needs no scope of its own.
  const searchSnippets: Record<string, string> = {};

  if (searchTerm && rankedConversations.length > 0) {
    const matches = await prisma.message.findMany({
      where: {
        conversationId: { in: rankedConversations.map((conversation) => conversation.id) },
        // Escaped for the same reason as the queue query: this has to find the
        // literal the advisor typed, not read it as a LIKE pattern.
        body: { contains: escapeLikeWildcards(searchTerm), mode: "insensitive" },
      },
      orderBy: [{ conversationId: "asc" }, { createdAt: "desc" }],
      distinct: ["conversationId"],
      select: { conversationId: true, body: true },
    });

    for (const match of matches) {
      searchSnippets[match.conversationId] = matchSnippet(match.body, searchTerm);
    }
  }

  return {
    conversations: rankedConversations,
    search: { term: searchTerm, snippets: searchSnippets },
    selectedConversation,
    users,
    tags,
    templates,
    dealershipSettings,
    queueStatus: {
      ...briefCoverage,
      aiConfigured: isAiOpsBriefConfigured(),
    },
  };
}

function isCommandCenterFocus(value?: string): value is CommandCenterFocus {
  return commandCenterFocuses.includes(value as CommandCenterFocus);
}

async function getCommandCenterFocusItems(
  user: AppUser,
  focus: CommandCenterFocus | undefined,
  now: Date,
  dueDayEnd: Date,
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
              ? { dueDate: { gte: now, lte: dueDayEnd } }
              : { dueDate: { lt: now } },
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
        meta: `${labelDepartment(task.department)} · ${task.assignedUser?.name ?? "Unassigned"}`,
        // The instant, not a rendering of it. Formatting the due date here
        // printed it on the server's clock - UTC on Vercel - so an advisor read
        // a follow-up she set for 10pm last night as due 3am today. The page
        // hands it to LocalTimestamp, which reads it on hers.
        dueAt: task.dueDate,
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
          AND: [notificationScope, activeNotificationWhere, { type: NotificationType.SLA_MISSED }],
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: notificationScanLimit,
        include: {
          conversation: { include: { customer: true, assignedUser: true } },
          task: { include: { customer: true } },
        },
      });

      return dedupeNotificationFacts(notifications, user.id)
        .slice(0, 25)
        .map((notification) => ({
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
  const eventForInsightCohort = {
    aiInsight: { is: insightScope },
  } satisfies Prisma.ProductEventWhereInput;

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
    prisma.conversationAiInsight.count({
      where: insightScope,
    }),
    prisma.productEvent.count({
      where: { ...eventForInsightCohort, type: ProductEventType.AI_RECOMMENDATION_ACCEPTED },
    }),
    prisma.productEvent.count({
      where: { ...eventForInsightCohort, type: ProductEventType.AI_RECOMMENDATION_DISMISSED },
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
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  // Whether a follow-up is due today is answered on the dealership's day, not
  // on the server's - see src/lib/dealership-day.ts. todayStart/todayEnd above
  // still bound the message-volume and response-time windows on the server's
  // day; that is a different question about a different clock, and deliberately
  // left where it was.
  const dueDayEnd = endOfDealershipDay(now);
  const responseWindowStart = subDays(todayStart, 14);
  const selectedFocus = isCommandCenterFocus(focusParam) ? focusParam : undefined;
  const userCanSeeAll = canSeeAll(user);
  const taskScope = scopedTaskWhere(user);
  const notificationScope = notificationScopeWhere(user);

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
    notificationCount,
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
    countNotificationFacts(user, { type: NotificationType.SLA_MISSED }),
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
    // Overdue means the due date has passed, which is the rule the alert rail
    // and the Tasks page badge already use. Splitting at midnight instead
    // reported "1 overdue" on the same screen as two overdue follow-up alerts,
    // so the two tiles now split today's queue at the current time: what is
    // still coming, and what is late.
    prisma.task.count({
      where: {
        AND: [activeTaskWhere, taskScope, { dueDate: { gte: now, lte: dueDayEnd } }],
      },
    }),
    prisma.task.count({
      where: {
        AND: [activeTaskWhere, taskScope, { dueDate: { lt: now } }],
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
      where: { AND: [notificationScope, activeNotificationWhere] },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: notificationPageScanLimit,
      include: {
        conversation: { include: { customer: true, assignedUser: true } },
        task: { include: { customer: true, assignedUser: true } },
      },
    }),
    countNotificationFacts(user),
    getCommandCenterFocusItems(user, selectedFocus, now, dueDayEnd, notificationScope),
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
          where: activeNotificationWhere,
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
    // Not a sample: this is where the rail sends the alerts it could not fit,
    // so it lists everything the deeper scan reached and the panel says how
    // many are beyond it.
    latestNotifications: dedupeNotificationFacts(latestNotifications, user.id).map((notification) => ({
      ...notification,
      href: notificationHref(notification),
    })),
    notificationCount,
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
      overdueFollowUps: employee.assignedTasks.filter((task) => task.dueDate < now).length,
      // Counted by fact, the same rule her own badge counts by. This column read
      // stored rows until the rail stopped doing so, which left the two screens
      // disagreeing about the same person: one thread with five unanswered texts
      // is 1 to her and was 5 here. That is the badge-against-list divergence
      // this work exists to close, recreated between two screens instead of
      // inside one, and it is a manager staffing a shift who acts on the
      // overstated number.
      activeNotifications: dedupeNotificationFacts(employee.notifications).length,
    })),
    aiOpsAnalytics,
  };
}

export async function getShellData(user: AppUser) {
  const scope = scopedConversationWhere(user);
  const userCanSeeAll = canSeeAll(user);
  // The rail's badge and the rail's list are the same question asked twice, so
  // they ask it with the same clause: a number the list cannot account for is
  // work the advisor has no way to reach.
  const alertWhere = activeNotificationsWhere(user);

  const [inboxCount, taskCount, alertCount, alerts] = await Promise.all([
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
    countNotificationFacts(user),
    prisma.notification.findMany({
      where: alertWhere,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: notificationScanLimit,
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
      command: alertCount,
    },
    // Every alert the scan reached, not a sample of them: the rail scrolls, so
    // the only alerts it leaves out are the ones beyond the scan limit, and it
    // says how many those are rather than dropping them silently.
    latestNotifications: dedupeNotificationFacts(alerts, user.id).map((notification) => ({
      ...notification,
      href: notificationHref(notification),
    })),
  };
}

export async function getCustomers(user: AppUser) {
  const readerScope = scopedConversationWhere(user);
  const customers = await prisma.customer.findMany({
    where: canSeeAll(user) ? {} : { conversations: { some: readerScope } },
    orderBy: { updatedAt: "desc" },
    include: {
      vehicles: true,
      // Scoped to the reader, because the row links to this conversation: the
      // newest thread overall can belong to a department she cannot open, and
      // that link lands on a bare 404.
      conversations: {
        where: readerScope,
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        select: { id: true, department: true, status: true },
      },
    },
  });

  // Which of these customers another department is also working. Nothing here
  // is out of the reader's reach for a manager or an admin, so the extra read
  // only happens for the accounts that can lose sight of a thread.
  if (canSeeAll(user) || customers.length === 0) {
    return customers.map((customer) => ({ ...customer, otherDepartments: [] as string[] }));
  }

  const everyThread = await prisma.conversation.findMany({
    where: { customerId: { in: customers.map((customer) => customer.id) } },
    orderBy: { lastMessageAt: "desc" },
    select: { customerId: true, department: true, assignedUserId: true },
  });

  // Grouped once rather than re-scanned per customer, which is the whole list
  // of threads walked again for every row on the page. Insertion order is the
  // query's own, so each customer's threads stay newest-first.
  const threadsByCustomer = new Map<string, typeof everyThread>();

  for (const thread of everyThread) {
    const threads = threadsByCustomer.get(thread.customerId);

    if (threads) {
      threads.push(thread);
    } else {
      threadsByCustomer.set(thread.customerId, [thread]);
    }
  }

  // Filtered here rather than with a negated Prisma clause: an unassigned
  // thread has a null assignedUserId, and `NOT (assignedUserId = x OR ...)` is
  // unknown rather than true for a null in SQL, which would drop exactly the
  // unclaimed threads this line exists to report.
  return customers.map((customer) => ({
    ...customer,
    otherDepartments: unreachableDepartments(user, threadsByCustomer.get(customer.id) ?? []),
  }));
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

/**
 * How many still-open conversations each staff member is holding right now.
 *
 * Coverage moves exactly these, so the number the board shows before the click
 * and the rows the hand-off actually moves are counted by one clause - see
 * openConversationWhere in src/lib/coverage.ts. A staff member holding none is
 * absent from the map rather than zero, which is what `?? 0` at each reader is
 * for.
 */
async function openConversationCounts(by: "assignedUserId" | "coveredForUserId") {
  const rows = await prisma.conversation.groupBy({
    by: [by],
    where: openConversationWhere,
    _count: { _all: true },
  });

  return new Map(
    rows.flatMap((row) => (row[by] ? [[row[by] as string, row._count._all] as const] : [])),
  );
}

/**
 * Who is holding each advisor's covered threads right now, which is not always
 * the cover - coverage chains, and a thread can be routed on by hand - and
 * whether any of them is held by nobody, which is the only case the cover
 * herself would be left with one. The board needs both so it can ask
 * coverageEndRefusal the same question the action asks, rather than offering a
 * button the action would refuse or refusing one the action would allow.
 */
async function coveredThreadHolders() {
  const rows = await prisma.conversation.findMany({
    where: { coveredForUserId: { not: null }, ...openConversationWhere },
    select: {
      coveredForUserId: true,
      status: true,
      assignedUser: { select: { id: true, name: true, active: true } },
    },
  });

  const byAdvisor = new Map<
    string,
    Array<{ status: string; heldBy: { id: string; name: string; active: boolean } | null }>
  >();

  for (const row of rows) {
    if (!row.coveredForUserId) {
      continue;
    }

    byAdvisor.set(row.coveredForUserId, [
      ...(byAdvisor.get(row.coveredForUserId) ?? []),
      { status: row.status, heldBy: row.assignedUser },
    ]);
  }

  return byAdvisor;
}

export type CoverageRow = {
  id: string;
  name: string;
  role: string;
  department: string | null;
  active: boolean;
  coveredByUserId: string | null;
  /** Who is holding this advisor's conversations, and from when. */
  coveredBy: { id: string; name: string; active: boolean } | null;
  coveredSince: Date | null;
  /** Open conversations assigned to this advisor right now. */
  openConversations: number;
  /**
   * Her open covered threads and who is actually reading each one, `heldBy`
   * null for one nobody holds. `landsOn` below cannot answer that question: it
   * reports a thread nobody holds as the cover's, because that is where leaving
   * the coverage with her would put it.
   */
  coveredThreads: Array<{ heldBy: { id: string; name: string; active: boolean } | null }>;
  /**
   * The accounts that would actually be left holding those if this coverage were
   * left with the cover - each thread's current holder, or the cover for one
   * nobody holds. Not always the cover, and empty when nothing is still open.
   */
  landsOn: Array<{ id: string; name: string; active: boolean }>;
  /** The advisors this staff member is currently covering for. */
  covering: Array<{ id: string; name: string }>;
};

/**
 * The floor's coverage, for the page that arranges it.
 *
 * Everyone is returned, including inactive accounts: an advisor who has already
 * been switched off is the case the feature was asked for, and her card is the
 * only place her stranded conversations are visible. Who the reader may act on,
 * and who may be offered as a cover, are decided by src/lib/coverage.ts from
 * these rows rather than by filtering them away here.
 */
export async function getCoverageBoard(): Promise<CoverageRow[]> {
  const [users, assigned, holders] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        role: true,
        department: true,
        active: true,
        coveredByUserId: true,
        coveredSince: true,
        coveredBy: { select: { id: true, name: true, active: true } },
        covering: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
    }),
    openConversationCounts("assignedUserId"),
    coveredThreadHolders(),
  ]);

  return users.map((user) => ({
    ...user,
    openConversations: assigned.get(user.id) ?? 0,
    coveredThreads: holders.get(user.id) ?? [],
    landsOn: user.coveredBy
      ? coverageLandsOn(user.coveredBy, holders.get(user.id) ?? [])
      : [],
  }));
}

export async function getSettingsData() {
  const [users, openConversations, dealershipSettings, health] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ role: "asc" }, { name: "asc" }],
      include: { coveredBy: { select: { id: true, name: true } } },
    }),
    // Deactivating an account is where conversations get stranded, so the screen
    // that does it says how many are on each account and who, if anyone, is
    // reading them. Counted by the clause coverage itself moves by.
    openConversationCounts("assignedUserId"),
    getDealershipSettings(),
    getIntegrationHealth(),
  ]);

  return {
    users: users.map((user) => ({
      ...user,
      openConversations: openConversations.get(user.id) ?? 0,
    })),
    dealershipSettings,
    health,
  };
}
