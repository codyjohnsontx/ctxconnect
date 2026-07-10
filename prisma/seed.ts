import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  MessageKind,
  NotificationType,
  OptInEventType,
  PreferredContactMethod,
  type Prisma,
  PrismaClient,
  ProductEventType,
  Priority,
  Role,
  TaskStatus,
  VehicleRelationship,
} from "../src/generated/prisma/client";
import {
  defaultDealershipSettings,
  defaultTagData,
  defaultTemplateData,
} from "./baseline-data";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to seed CTX Chat.");
}

const seedConnectionString = connectionString;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: seedConnectionString }),
});

const dealershipName = defaultDealershipSettings.dealershipName;
const demoPassword = "ctxdemo123";
const demoSeedAllowFlag = "CTX_ALLOW_DEMO_SEED";

const minutesFromNow = (minutes: number) =>
  new Date(Date.now() + minutes * 60 * 1000);

const hoursFromNow = (hours: number) =>
  new Date(Date.now() + hours * 60 * 60 * 1000);

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

type SeedMessage = readonly [MessageDirection, string, DeliveryStatus];

type CustomerSeedEntry = {
  name: string;
  phone: string;
  email: string;
  vehicle: readonly [number, string, string, string, string, number, VehicleRelationship];
  department: Department;
  assignedUserId: string | null;
  priority: Priority;
  status: ConversationStatus;
  tagNames: readonly string[];
  subject: string;
  messages: readonly SeedMessage[];
  task: string;
  taskStatus?: TaskStatus;
  dueDate: Date;
  optedInAt?: Date | null;
  smsOptedIn?: boolean;
  smsOptedOut?: boolean;
  optedOutAt?: Date | null;
  customerNotes?: string;
};

function isAllowedDemoSeedTarget(urlString: string) {
  let url: URL;

  try {
    url = new URL(urlString);
  } catch {
    return false;
  }

  const target = `${url.protocol}//${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const hostname = url.hostname.toLowerCase();

  if (hostname.endsWith(".neon.tech")) {
    return false;
  }

  return (
    localHosts.has(hostname) ||
    /(^|[._/-])(dev|demo|preview|staging|test|testing|local|nonprod|non-production)([._/-]|$)/i.test(target)
  );
}

function assertSafeSeedTarget() {
  if (process.env[demoSeedAllowFlag] === "true") {
    return;
  }

  if (isAllowedDemoSeedTarget(seedConnectionString)) {
    return;
  }

  throw new Error(
    `Refusing to seed CTX Chat because DIRECT_URL/DATABASE_URL does not look local or non-production. Set ${demoSeedAllowFlag}=true only for intentional local/demo seeding.`,
  );
}

function requiredSeedDate(value: Date | null | undefined, message: string) {
  if (!value) {
    throw new Error(message);
  }

  return value;
}

async function resetCustomerDemoData(customerId: string) {
  await prisma.notification.deleteMany({
    where: {
      OR: [
        { conversation: { customerId } },
        { task: { customerId } },
      ],
    },
  });
  await prisma.productEvent.deleteMany({
    where: { conversation: { customerId } },
  });
  await prisma.conversationAiInsight.deleteMany({
    where: { conversation: { customerId } },
  });
  await prisma.message.deleteMany({
    where: { conversation: { customerId } },
  });
  await prisma.task.deleteMany({ where: { customerId } });
  await prisma.conversation.deleteMany({ where: { customerId } });
  await prisma.customerVehicle.deleteMany({ where: { customerId } });
  await prisma.optInEvent.deleteMany({ where: { customerId } });
}

async function createAiInsightWithEvents(input: {
  conversationId: string;
  requestedByUserId: string;
  model?: string;
  summary: string;
  customerNeed: string;
  riskLevel: Priority;
  riskReasons: string[];
  escalationRecommended: boolean;
  escalationReason?: string | null;
  suggestedDepartment?: Department | null;
  suggestedNextAction: string;
  suggestedReply?: string | null;
  suggestedTaskTitle?: string | null;
  confidence: number;
  acceptedAt?: Date | null;
  dismissedAt?: Date | null;
  events: Array<{
    type: ProductEventType;
    userId: string;
    createdAt?: Date;
    metadata?: Prisma.InputJsonValue;
  }>;
}) {
  const generatedEvent = input.events.find((event) => event.type === ProductEventType.AI_INSIGHT_GENERATED);

  if (!generatedEvent?.createdAt) {
    throw new Error("Seeded AI insight requires an AI_INSIGHT_GENERATED event with a deterministic createdAt.");
  }

  const generatedAt = generatedEvent.createdAt;
  const insight = await prisma.conversationAiInsight.create({
    data: {
      conversationId: input.conversationId,
      requestedByUserId: input.requestedByUserId,
      model: input.model ?? "seeded-demo",
      summary: input.summary,
      customerNeed: input.customerNeed,
      riskLevel: input.riskLevel,
      riskReasons: input.riskReasons,
      escalationRecommended: input.escalationRecommended,
      escalationReason: input.escalationReason ?? null,
      suggestedDepartment: input.suggestedDepartment ?? null,
      suggestedNextAction: input.suggestedNextAction,
      suggestedReply: input.suggestedReply ?? null,
      suggestedTaskTitle: input.suggestedTaskTitle ?? null,
      confidence: input.confidence,
      createdAt: generatedAt,
      acceptedAt: input.acceptedAt ?? null,
      dismissedAt: input.dismissedAt ?? null,
    },
  });

  for (const event of input.events) {
    await prisma.productEvent.upsert({
      where: {
        type_aiInsightId: {
          type: event.type,
          aiInsightId: insight.id,
        },
      },
      update: {},
      create: {
        type: event.type,
        userId: event.userId,
        conversationId: input.conversationId,
        aiInsightId: insight.id,
        metadata: event.metadata,
        createdAt: event.createdAt,
      },
    });
  }

  return insight;
}

async function main() {
  assertSafeSeedTarget();

  const passwordHash = await hash(demoPassword, 12);

  await prisma.dealershipSettings.upsert({
    where: { id: defaultDealershipSettings.id },
    update: {},
    create: defaultDealershipSettings,
  });

  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: "admin@ctxchat.local" },
      update: {},
      create: {
        name: "Cody Johnson",
        email: "admin@ctxchat.local",
        passwordHash,
        role: Role.ADMIN,
        department: Department.GENERAL,
      },
    }),
    prisma.user.upsert({
      where: { email: "gm@ctxchat.local" },
      update: {},
      create: {
        name: "Dana Parker",
        email: "gm@ctxchat.local",
        passwordHash,
        role: Role.MANAGER,
        department: Department.GENERAL,
      },
    }),
    prisma.user.upsert({
      where: { email: "sales@ctxchat.local" },
      update: {},
      create: {
        name: "Mason Reed",
        email: "sales@ctxchat.local",
        passwordHash,
        role: Role.SALES,
        department: Department.SALES,
      },
    }),
    prisma.user.upsert({
      where: { email: "service@ctxchat.local" },
      update: {},
      create: {
        name: "Alyssa Torres",
        email: "service@ctxchat.local",
        passwordHash,
        role: Role.SERVICE,
        department: Department.SERVICE,
      },
    }),
    prisma.user.upsert({
      where: { email: "parts@ctxchat.local" },
      update: {},
      create: {
        name: "Ben Whitaker",
        email: "parts@ctxchat.local",
        passwordHash,
        role: Role.PARTS,
        department: Department.PARTS,
      },
    }),
  ]);

  const [admin, manager, sales, service, parts] = users;

  await prisma.notification.deleteMany();

  const tags = new Map<string, string>();
  for (const [name, color] of defaultTagData) {
    const tag = await prisma.tag.upsert({
      where: { name },
      update: { color },
      create: { name, color },
    });
    tags.set(name, tag.id);
  }

  await prisma.template.deleteMany();
  await prisma.template.createMany({
    data: defaultTemplateData,
  });

  const customerData: CustomerSeedEntry[] = [
    {
      name: "Evan Brooks",
      phone: "+15125550101",
      email: "evan.brooks@example.com",
      vehicle: [2025, "Ducati", "Panigale V4", "ZDM1AAAW9PB001001", "D25014", 6, VehicleRelationship.INTERESTED] as const,
      department: Department.SALES,
      assignedUserId: sales.id,
      priority: Priority.URGENT,
      status: ConversationStatus.WAITING_ON_STAFF,
      tagNames: ["Hot lead"],
      subject: "Panigale V4 availability",
      messages: [
        [MessageDirection.INBOUND, "Is the red Panigale V4 still available? I can come by after lunch.", DeliveryStatus.RECEIVED],
        [MessageDirection.OUTBOUND, "It is available. I can have it pulled up front around 1:30.", DeliveryStatus.DELIVERED],
        [MessageDirection.INBOUND, "Great. Can you send the OTD number before I leave work?", DeliveryStatus.RECEIVED],
        [MessageDirection.INTERNAL, "Sales floor confirmed red Panigale is still available.", DeliveryStatus.INTERNAL],
        [MessageDirection.INBOUND, "If the number works I can put a deposit down today.", DeliveryStatus.RECEIVED],
      ] as const,
      task: "Send Panigale V4 OTD quote",
      taskStatus: TaskStatus.DONE,
      dueDate: hoursFromNow(2),
    },
    {
      name: "Nina Caldwell",
      phone: "+15125550102",
      email: "nina.caldwell@example.com",
      vehicle: [2023, "Triumph", "Tiger 900", "SMTDAD85HPT001234", "U24088", 8420, VehicleRelationship.SERVICE_UNIT] as const,
      department: Department.SERVICE,
      assignedUserId: service.id,
      priority: Priority.HIGH,
      status: ConversationStatus.FOLLOW_UP_NEEDED,
      tagNames: ["Needs approval"],
      subject: "RO 48219 service update",
      messages: [
        [MessageDirection.INBOUND, "Any update on my Tiger? I need it for a trip this weekend.", DeliveryStatus.RECEIVED],
        [MessageDirection.INTERNAL, "RO 48219 waiting on customer approval for rear tire and brake pads.", DeliveryStatus.INTERNAL],
        [MessageDirection.OUTBOUND, "Estimate sent. We still need approval before we can complete the tire and brake work.", DeliveryStatus.DELIVERED],
        [MessageDirection.INBOUND, "I am in meetings, can someone leave a clear voicemail?", DeliveryStatus.RECEIVED],
      ] as const,
      task: "Call Nina with estimate approval",
      dueDate: hoursFromNow(-3),
    },
    {
      name: "Marco Silva",
      phone: "+15125550103",
      email: "marco.silva@example.com",
      vehicle: [2024, "Aprilia", "Tuareg 660", "ZD4KGUA08RS000444", "A24031", 1200, VehicleRelationship.OWNED] as const,
      department: Department.PARTS,
      assignedUserId: parts.id,
      priority: Priority.NORMAL,
      status: ConversationStatus.WAITING_ON_STAFF,
      tagNames: ["Parts delay"],
      subject: "Tires arrival",
      messages: [
        [MessageDirection.INBOUND, "Did the Pirelli tires for my Tuareg arrive yet?", DeliveryStatus.RECEIVED],
        [MessageDirection.OUTBOUND, "Front arrived this morning. Rear is still showing tomorrow.", DeliveryStatus.SENT],
        [MessageDirection.INTERNAL, "Rear tire ETA slipped from supplier; check alternate distributor.", DeliveryStatus.INTERNAL],
      ] as const,
      task: "Text Marco when rear tire lands",
      dueDate: daysFromNow(1),
    },
    {
      name: "Jules Bennett",
      phone: "+15125550104",
      email: "jules.bennett@example.com",
      vehicle: [2024, "Ducati", "Multistrada V4", "ZDM2A00W4RB002210", "D24077", 55, VehicleRelationship.INTERESTED] as const,
      department: Department.GENERAL,
      assignedUserId: manager.id,
      priority: Priority.NORMAL,
      status: ConversationStatus.OPEN,
      tagNames: [],
      subject: "Missed call follow-up",
      messages: [
        [MessageDirection.OUTBOUND, "Hi Jules, sorry we missed your call. How can we help today?", DeliveryStatus.DELIVERED],
      ] as const,
      task: "Route missed call if no reply",
      dueDate: hoursFromNow(5),
    },
    {
      name: "Priya Patel",
      phone: "+15125550105",
      email: "priya.patel@example.com",
      vehicle: [2022, "Moto Guzzi", "V85 TT", "ZGULDU009NM000871", "S22104", 15400, VehicleRelationship.SERVICE_UNIT] as const,
      department: Department.SERVICE,
      assignedUserId: service.id,
      priority: Priority.HIGH,
      status: ConversationStatus.WAITING_ON_CUSTOMER,
      tagNames: ["Pickup ready"],
      subject: "Bike ready for pickup",
      messages: [
        [MessageDirection.OUTBOUND, "Your V85 TT is ready for pickup. We are here until 6.", DeliveryStatus.DELIVERED],
        [MessageDirection.INTERNAL, "RO paid. Bike parked in service delivery row.", DeliveryStatus.INTERNAL],
      ] as const,
      task: "Confirm pickup time",
      dueDate: hoursFromNow(1),
    },
    {
      name: "Owen Price",
      phone: "+15125550106",
      email: "owen.price@example.com",
      vehicle: [2021, "Triumph", "Street Triple", "SMTL03NE7MT000219", "T21042", 9360, VehicleRelationship.TRADE_IN] as const,
      department: Department.SALES,
      assignedUserId: sales.id,
      priority: Priority.HIGH,
      status: ConversationStatus.FOLLOW_UP_NEEDED,
      tagNames: ["Trade-in"],
      subject: "Trade-in follow-up",
      messages: [
        [MessageDirection.INBOUND, "I uploaded photos of my Street Triple. What do you think it is worth?", DeliveryStatus.RECEIVED],
      ] as const,
      task: "Review Street Triple trade photos",
      dueDate: hoursFromNow(4),
    },
    {
      name: "Camila Reyes",
      phone: "+15125550107",
      email: "camila.reyes@example.com",
      vehicle: [2025, "Aprilia", "RSV4", "ZD4KZUA09SS000321", "A25009", 4, VehicleRelationship.INTERESTED] as const,
      department: Department.FINANCE,
      assignedUserId: manager.id,
      priority: Priority.HIGH,
      status: ConversationStatus.OPEN,
      tagNames: ["Financing", "Hot lead"],
      subject: "Financing question",
      messages: [
        [MessageDirection.INBOUND, "Can you text me the financing options on the RSV4?", DeliveryStatus.RECEIVED],
        [MessageDirection.OUTBOUND, "Yes. I can send the worksheet with estimated monthly options and cash due at signing.", DeliveryStatus.DELIVERED],
        [MessageDirection.INBOUND, "Please include the lowest payment option and the shortest term option.", DeliveryStatus.RECEIVED],
      ] as const,
      task: "Send finance worksheet options",
      dueDate: hoursFromNow(3),
    },
    {
      name: "Theo Hamilton",
      phone: "+15125550108",
      email: "theo.hamilton@example.com",
      vehicle: [2024, "MV Agusta", "Brutale", "ZCGM3R0W5RV000551", "M24018", 18, VehicleRelationship.INTERESTED] as const,
      department: Department.SALES,
      assignedUserId: null,
      priority: Priority.NORMAL,
      status: ConversationStatus.OPEN,
      tagNames: [],
      subject: "Test ride request",
      messages: [
        [MessageDirection.INBOUND, "Do you allow test rides on the MV Agusta Brutale?", DeliveryStatus.RECEIVED],
      ] as const,
      task: "Assign MV Brutale test ride request",
      dueDate: hoursFromNow(6),
    },
    {
      name: "Lena Ortiz",
      phone: "+15125550109",
      email: "lena.ortiz@example.com",
      vehicle: [2022, "Ducati", "Monster", "ZDM2A00W7NB003109", "U22166", 6900, VehicleRelationship.OWNED] as const,
      department: Department.GENERAL,
      assignedUserId: manager.id,
      priority: Priority.NORMAL,
      status: ConversationStatus.WAITING_ON_STAFF,
      tagNames: [],
      subject: "Accessory availability",
      optedInAt: daysFromNow(-30),
      smsOptedIn: false,
      smsOptedOut: true,
      optedOutAt: hoursFromNow(-2),
      customerNotes: "SMS opt-out captured through seeded STOP workflow. Use phone or email for outreach.",
      messages: [
        [MessageDirection.INBOUND, "Do you have the lower Monster seat in stock?", DeliveryStatus.RECEIVED],
        [MessageDirection.INBOUND, "STOP", DeliveryStatus.RECEIVED],
        [MessageDirection.INTERNAL, "Customer opted out by SMS STOP. Do not send outbound SMS.", DeliveryStatus.INTERNAL],
      ] as const,
      task: "Follow up with Lena by phone or email",
      dueDate: hoursFromNow(7),
    },
  ];
  const seededPhones = customerData.map((entry) => entry.phone);

  for (const entry of customerData) {
    const optedInAt = entry.optedInAt ?? daysFromNow(-30);
    const customer = await prisma.customer.upsert({
      where: { phone: entry.phone },
      update: {
        name: entry.name,
        email: entry.email,
        preferredContactMethod: entry.smsOptedOut ? PreferredContactMethod.PHONE : PreferredContactMethod.SMS,
        smsOptedIn: entry.smsOptedIn ?? true,
        smsOptedOut: entry.smsOptedOut ?? false,
        optedInAt,
        optedOutAt: entry.optedOutAt ?? null,
        notes: entry.customerNotes ?? `${entry.name} is part of the ${dealershipName} demo workflow.`,
      },
      create: {
        name: entry.name,
        phone: entry.phone,
        email: entry.email,
        preferredContactMethod: entry.smsOptedOut ? PreferredContactMethod.PHONE : PreferredContactMethod.SMS,
        smsOptedIn: entry.smsOptedIn ?? true,
        smsOptedOut: entry.smsOptedOut ?? false,
        optedInAt,
        optedOutAt: entry.optedOutAt ?? null,
        notes: entry.customerNotes ?? `${entry.name} is part of the ${dealershipName} demo workflow.`,
      },
    });

    await resetCustomerDemoData(customer.id);

    const [year, make, model, vin, stockNumber, mileage, relationship] = entry.vehicle;
    await prisma.customerVehicle.create({
      data: {
        customerId: customer.id,
        year,
        make,
        model,
        vin,
        stockNumber,
        mileage,
        relationship,
      },
    });

    const messageTimes = entry.messages.map((_, index) => hoursFromNow(-entry.messages.length + index));
    const lastMessageCreatedAt = messageTimes.at(-1) ?? new Date();
    const conversation = await prisma.conversation.create({
      data: {
        customerId: customer.id,
        assignedUserId: entry.assignedUserId,
        department: entry.department,
        priority: entry.priority,
        status: entry.status,
        subject: entry.subject,
        unread: entry.messages.at(-1)?.[0] === MessageDirection.INBOUND,
        lastMessageAt: lastMessageCreatedAt,
      },
    });

    for (const [index, message] of entry.messages.entries()) {
      const [direction, body, deliveryStatus] = message;
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderUserId:
            direction === MessageDirection.OUTBOUND
              ? entry.assignedUserId ?? manager.id
              : direction === MessageDirection.INTERNAL
                ? admin.id
                : null,
          direction,
          kind: direction === MessageDirection.INTERNAL ? MessageKind.NOTE : MessageKind.SMS,
          body,
          deliveryStatus,
          createdAt: messageTimes[index],
        },
      });
    }

    for (const tagName of entry.tagNames) {
      const tagId = tags.get(tagName);
      if (tagId) {
        await prisma.conversationTag.create({
          data: { conversationId: conversation.id, tagId },
        });
      }
    }

    await prisma.task.create({
      data: {
        title: entry.task,
        customerId: customer.id,
        conversationId: conversation.id,
        assignedUserId: entry.assignedUserId,
        department: entry.department,
        dueDate: entry.dueDate,
        priority: entry.priority,
        status: entry.taskStatus ?? TaskStatus.OPEN,
      },
    });

    await prisma.optInEvent.create({
      data: {
        customerId: customer.id,
        type: OptInEventType.OPT_IN,
        source: "seed",
        createdAt: optedInAt,
      },
    });

    if (entry.smsOptedOut) {
      const optedOutAt = requiredSeedDate(
        entry.optedOutAt,
        `Seeded SMS opt-out customer ${entry.name} requires a deterministic optedOutAt timestamp.`,
      );

      await prisma.optInEvent.create({
        data: {
          customerId: customer.id,
          type: OptInEventType.OPT_OUT,
          source: "seed",
          createdAt: optedOutAt,
        },
      });
    }
  }

  const seededConversations = await prisma.conversation.findMany({
    where: {
      customer: {
        phone: { in: seededPhones },
      },
    },
    include: {
      customer: true,
      assignedUser: true,
      messages: true,
      tasks: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const panigaleLead = seededConversations.find((conversation) =>
    conversation.subject?.includes("Panigale"),
  );
  const tigerService = seededConversations.find((conversation) =>
    conversation.subject?.includes("RO 48219"),
  );
  const mvTestRide = seededConversations.find((conversation) =>
    conversation.subject?.includes("Test ride"),
  );
  const tiresParts = seededConversations.find((conversation) =>
    conversation.subject?.includes("Tires"),
  );
  const financeLead = seededConversations.find((conversation) =>
    conversation.subject?.includes("Financing"),
  );
  const smsOptOutConversation = seededConversations.find((conversation) =>
    conversation.customer.name === "Lena Ortiz",
  );

  if (panigaleLead) {
    await prisma.notification.createMany({
      data: [
        {
          type: NotificationType.SLA_MISSED,
          title: "Sales response SLA missed",
          body: `${panigaleLead.customer.name} asked for an OTD number and still needs a staff response.`,
          recipientUserId: manager.id,
          conversationId: panigaleLead.id,
          department: panigaleLead.department,
          priority: Priority.URGENT,
          dueAt: hoursFromNow(-1),
        },
        {
          type: NotificationType.NEW_INBOUND_MESSAGE,
          title: "New customer message",
          body: `${panigaleLead.customer.name}: Can you send the OTD number?`,
          recipientUserId: sales.id,
          conversationId: panigaleLead.id,
          messageId: panigaleLead.messages.at(-1)?.id,
          department: panigaleLead.department,
          priority: Priority.HIGH,
        },
      ],
    });
  }

  if (tigerService?.tasks[0]) {
    await prisma.notification.create({
      data: {
        type: NotificationType.FOLLOW_UP_OVERDUE,
        title: "Follow-up overdue",
        body: `${tigerService.customer.name} needs estimate approval on RO 48219.`,
        recipientUserId: service.id,
        conversationId: tigerService.id,
        taskId: tigerService.tasks[0].id,
        department: tigerService.department,
        priority: Priority.HIGH,
        dueAt: tigerService.tasks[0].dueDate,
      },
    });
  }

  if (mvTestRide) {
    await prisma.notification.create({
      data: {
        type: NotificationType.UNASSIGNED_CONVERSATION,
        title: "Unassigned sales lead",
        body: `${mvTestRide.customer.name} asked about an MV Agusta Brutale test ride.`,
        recipientUserId: manager.id,
        conversationId: mvTestRide.id,
        department: mvTestRide.department,
        priority: Priority.HIGH,
        dueAt: hoursFromNow(-2),
      },
    });
  }

  if (tiresParts?.messages[1]) {
    await prisma.message.update({
      where: { id: tiresParts.messages[1].id },
      data: {
        deliveryStatus: DeliveryStatus.FAILED,
        errorMessage: "Carrier rejected message during demo seed.",
      },
    });
    await prisma.notification.create({
      data: {
        type: NotificationType.MESSAGE_FAILED,
        title: "Message failed",
        body: `${tiresParts.customer.name}: Carrier rejected message during demo seed.`,
        recipientUserId: manager.id,
        conversationId: tiresParts.id,
        messageId: tiresParts.messages[1].id,
        department: tiresParts.department,
        priority: Priority.HIGH,
      },
    });
  }

  if (panigaleLead) {
    const acceptedAt = minutesFromNow(-40);
    const followUpCreatedAt = minutesFromNow(-35);
    await createAiInsightWithEvents({
      conversationId: panigaleLead.id,
      requestedByUserId: manager.id,
      summary: "Urgent Panigale lead is asking for an out-the-door number and is ready to place a deposit today.",
      customerNeed: "Needs final pricing before leaving work for a 1:30 visit.",
      riskLevel: Priority.URGENT,
      riskReasons: [
        "Customer is ready to buy today.",
        "Customer explicitly asked for pricing before arrival.",
        "Delayed response could lose the deposit.",
      ],
      escalationRecommended: true,
      escalationReason: "Sales manager should own the pricing response because the customer is purchase-ready.",
      suggestedDepartment: Department.SALES,
      suggestedNextAction: "Sales manager should send the OTD quote and confirm the 1:30 appointment.",
      suggestedReply: "Evan, I am confirming the OTD number now and will have the red Panigale ready for your 1:30 visit.",
      suggestedTaskTitle: "Send OTD quote and confirm 1:30 visit",
      confidence: 92,
      acceptedAt,
      events: [
        {
          type: ProductEventType.AI_INSIGHT_GENERATED,
          userId: manager.id,
          createdAt: minutesFromNow(-45),
          metadata: {
            model: "seeded-demo",
            riskLevel: Priority.URGENT,
            escalationRecommended: true,
            source: "seed",
          },
        },
        {
          type: ProductEventType.AI_RECOMMENDATION_ACCEPTED,
          userId: manager.id,
          createdAt: acceptedAt,
          metadata: { action: "ACCEPTED", source: "seed" },
        },
        {
          type: ProductEventType.AI_REPLY_COPIED,
          userId: sales.id,
          createdAt: minutesFromNow(-38),
          metadata: { action: "REPLY_COPIED", source: "seed" },
        },
        {
          type: ProductEventType.AI_FOLLOW_UP_CREATED,
          userId: manager.id,
          createdAt: followUpCreatedAt,
          metadata: { source: "seed" },
        },
      ],
    });
    await prisma.task.create({
      data: {
        title: "Send OTD quote and confirm 1:30 visit",
        description: "Created from seeded AI Ops Brief recommendation.",
        customerId: panigaleLead.customerId,
        conversationId: panigaleLead.id,
        assignedUserId: sales.id,
        department: Department.SALES,
        dueDate: hoursFromNow(1),
        priority: Priority.URGENT,
        status: TaskStatus.OPEN,
        createdAt: followUpCreatedAt,
      },
    });
  }

  if (tigerService) {
    const noteCreatedAt = minutesFromNow(-45);
    await createAiInsightWithEvents({
      conversationId: tigerService.id,
      requestedByUserId: manager.id,
      summary: "Service approval is overdue and the customer needs a clear voicemail before a weekend trip.",
      customerNeed: "Needs approval details for tire and brake work without having to text during meetings.",
      riskLevel: Priority.HIGH,
      riskReasons: [
        "Follow-up task is overdue.",
        "Customer has a near-term trip dependency.",
        "Approval is blocking service completion.",
      ],
      escalationRecommended: true,
      escalationReason: "Service should call and leave a specific approval voicemail instead of waiting on SMS.",
      suggestedDepartment: Department.SERVICE,
      suggestedNextAction: "Call customer with estimate approval details and leave a clear voicemail.",
      suggestedReply: null,
      suggestedTaskTitle: "Call Nina for tire and brake approval",
      confidence: 88,
      events: [
        {
          type: ProductEventType.AI_INSIGHT_GENERATED,
          userId: manager.id,
          createdAt: minutesFromNow(-50),
          metadata: {
            model: "seeded-demo",
            riskLevel: Priority.HIGH,
            escalationRecommended: true,
            source: "seed",
          },
        },
        {
          type: ProductEventType.AI_NOTE_CREATED,
          userId: service.id,
          createdAt: noteCreatedAt,
          metadata: { source: "seed" },
        },
      ],
    });
    await prisma.message.create({
      data: {
        conversationId: tigerService.id,
        senderUserId: service.id,
        direction: MessageDirection.INTERNAL,
        kind: MessageKind.NOTE,
        body: "AI Ops Brief note: Customer needs estimate approval before weekend trip; service should call with tire and brake options.",
        deliveryStatus: DeliveryStatus.INTERNAL,
        createdAt: noteCreatedAt,
      },
    });
    await prisma.conversation.update({
      where: { id: tigerService.id },
      data: { lastMessageAt: noteCreatedAt },
    });
  }

  if (tiresParts) {
    const dismissedAt = minutesFromNow(-52);
    await createAiInsightWithEvents({
      conversationId: tiresParts.id,
      requestedByUserId: manager.id,
      summary: "Parts update is at risk because the outbound tire ETA message failed and the rear tire slipped.",
      customerNeed: "Needs an accurate rear tire ETA and a working outreach channel.",
      riskLevel: Priority.HIGH,
      riskReasons: [
        "Most recent outbound customer update failed.",
        "Supplier ETA changed after the customer asked for status.",
        "Parts delay can turn into a service pickup issue.",
      ],
      escalationRecommended: false,
      suggestedDepartment: Department.PARTS,
      suggestedNextAction: "Parts team should confirm the rear tire ETA, then call or resend the update.",
      suggestedReply: "Marco, the front tire is here. The rear ETA slipped, so we are checking an alternate distributor and will call with the confirmed timing.",
      suggestedTaskTitle: "Confirm rear tire ETA and update Marco",
      confidence: 84,
      dismissedAt,
      events: [
        {
          type: ProductEventType.AI_INSIGHT_GENERATED,
          userId: manager.id,
          createdAt: minutesFromNow(-55),
          metadata: {
            model: "seeded-demo",
            riskLevel: Priority.HIGH,
            escalationRecommended: false,
            source: "seed",
          },
        },
        {
          type: ProductEventType.AI_RECOMMENDATION_DISMISSED,
          userId: parts.id,
          createdAt: dismissedAt,
          metadata: { action: "DISMISSED", source: "seed" },
        },
      ],
    });
  }

  if (financeLead) {
    const acceptedAt = minutesFromNow(-30);
    await createAiInsightWithEvents({
      conversationId: financeLead.id,
      requestedByUserId: manager.id,
      summary: "Finance lead wants payment options for the RSV4 and asked for two specific worksheet views.",
      customerNeed: "Needs lowest-payment and shortest-term financing options by text.",
      riskLevel: Priority.NORMAL,
      riskReasons: [
        "Customer is engaged and asking for purchase-path details.",
        "Finance response should compare options clearly.",
      ],
      escalationRecommended: false,
      suggestedDepartment: Department.FINANCE,
      suggestedNextAction: "Send finance worksheet options that compare lowest payment and shortest term.",
      suggestedReply: "Camila, I will send both options: lowest estimated monthly payment and shortest available term, with cash due at signing.",
      suggestedTaskTitle: "Send RSV4 finance worksheet options",
      confidence: 86,
      acceptedAt,
      events: [
        {
          type: ProductEventType.AI_INSIGHT_GENERATED,
          userId: manager.id,
          createdAt: minutesFromNow(-35),
          metadata: {
            model: "seeded-demo",
            riskLevel: Priority.NORMAL,
            escalationRecommended: false,
            source: "seed",
          },
        },
        {
          type: ProductEventType.AI_RECOMMENDATION_ACCEPTED,
          userId: manager.id,
          createdAt: acceptedAt,
          metadata: { action: "ACCEPTED", source: "seed" },
        },
        {
          type: ProductEventType.AI_REPLY_COPIED,
          userId: manager.id,
          createdAt: minutesFromNow(-28),
          metadata: { action: "REPLY_COPIED", source: "seed" },
        },
      ],
    });
  }

  if (smsOptOutConversation) {
    await createAiInsightWithEvents({
      conversationId: smsOptOutConversation.id,
      requestedByUserId: manager.id,
      summary: "Customer asked about a Monster accessory but opted out by SMS STOP in the same thread.",
      customerNeed: "Needs accessory availability answered through a non-SMS channel.",
      riskLevel: Priority.NORMAL,
      riskReasons: [
        "Customer is opted out of SMS.",
        "Any outbound follow-up must use phone or email.",
      ],
      escalationRecommended: false,
      suggestedDepartment: Department.GENERAL,
      suggestedNextAction: "Use a non-SMS channel before any customer outreach because the customer is opted out.",
      suggestedReply: null,
      suggestedTaskTitle: "Follow up with Lena by phone or email",
      confidence: 93,
      events: [
        {
          type: ProductEventType.AI_INSIGHT_GENERATED,
          userId: manager.id,
          createdAt: minutesFromNow(-25),
          metadata: {
            model: "seeded-demo",
            riskLevel: Priority.NORMAL,
            escalationRecommended: false,
            source: "seed",
          },
        },
      ],
    });
  }

  console.log(`Seeded ${dealershipName}. Demo password: ${demoPassword}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
