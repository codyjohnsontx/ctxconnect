import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
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
  PrismaClient,
  Priority,
  Role,
  TaskStatus,
  VehicleRelationship,
} from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed CTX Chat.");
}

const prisma = new PrismaClient({
  adapter: connectionString.startsWith("file:")
    ? new PrismaBetterSqlite3({ url: connectionString })
    : new PrismaPg({ connectionString }),
});

const dealershipName = "CTX MotoWorks";
const demoPassword = "ctxdemo123";

const hoursFromNow = (hours: number) =>
  new Date(Date.now() + hours * 60 * 60 * 1000);

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

async function main() {
  const passwordHash = await hash(demoPassword, 12);

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

  const tagData = [
    ["Hot lead", "#dc2626"],
    ["Pickup ready", "#16a34a"],
    ["Needs approval", "#d97706"],
    ["Financing", "#2563eb"],
    ["Trade-in", "#7c3aed"],
    ["Parts delay", "#0891b2"],
  ] as const;

  const tags = new Map<string, string>();
  for (const [name, color] of tagData) {
    const tag = await prisma.tag.upsert({
      where: { name },
      update: { color },
      create: { name, color },
    });
    tags.set(name, tag.id);
  }

  await prisma.template.deleteMany();
  await prisma.template.createMany({
    data: [
      {
        name: "New lead follow-up",
        department: Department.SALES,
        body: "Hi {{customerName}}, this is {{advisorName}} at {{dealershipName}}. I saw your interest in the {{unit}}. Are you free today to talk details or schedule a test ride?",
        variables: ["customerName", "advisorName", "dealershipName", "unit"],
      },
      {
        name: "Trade-in follow-up",
        department: Department.SALES,
        body: "Hi {{customerName}}, we can take a closer look at your trade-in today. Send a few photos and the VIN when you have a minute.",
        variables: ["customerName"],
      },
      {
        name: "Test ride scheduling",
        department: Department.SALES,
        body: "Hi {{customerName}}, we can schedule your test ride for {{appointmentDate}}. Please bring your motorcycle endorsement and insurance card.",
        variables: ["customerName", "appointmentDate"],
      },
      {
        name: "Still interested check-in",
        department: Department.SALES,
        body: "Hi {{customerName}}, checking in to see if you are still interested in the {{unit}}. I can send updated availability and pricing.",
        variables: ["customerName", "unit"],
      },
      {
        name: "Vehicle availability reply",
        department: Department.SALES,
        body: "Good news, {{customerName}}. The {{unit}} is currently available. Would you like me to hold time for you to see it?",
        variables: ["customerName", "unit"],
      },
      {
        name: "Appointment confirmation",
        department: Department.SERVICE,
        body: "Hi {{customerName}}, your service appointment is confirmed for {{appointmentDate}} with {{advisorName}}.",
        variables: ["customerName", "appointmentDate", "advisorName"],
      },
      {
        name: "Bike checked in",
        department: Department.SERVICE,
        body: "Hi {{customerName}}, your {{unit}} is checked in. We will update you after the inspection.",
        variables: ["customerName", "unit"],
      },
      {
        name: "Estimate ready",
        department: Department.SERVICE,
        body: "Hi {{customerName}}, your estimate is ready. Reply here or call us and we can walk through the RO.",
        variables: ["customerName"],
      },
      {
        name: "Approval needed",
        department: Department.SERVICE,
        body: "Hi {{customerName}}, we need your approval before continuing service on your {{unit}}. Reply APPROVE or call {{advisorName}}.",
        variables: ["customerName", "unit", "advisorName"],
      },
      {
        name: "Bike ready for pickup",
        department: Department.SERVICE,
        body: "Hi {{customerName}}, your {{unit}} is ready for pickup today. We are here until {{pickupTime}}.",
        variables: ["customerName", "unit", "pickupTime"],
      },
      {
        name: "Delayed parts update",
        department: Department.SERVICE,
        body: "Hi {{customerName}}, parts for your {{unit}} are delayed. We will update you as soon as the shipment lands.",
        variables: ["customerName", "unit"],
      },
      {
        name: "Parts arrived",
        department: Department.PARTS,
        body: "Hi {{customerName}}, your parts have arrived at {{dealershipName}} and are ready for pickup.",
        variables: ["customerName", "dealershipName"],
      },
      {
        name: "Parts backordered",
        department: Department.PARTS,
        body: "Hi {{customerName}}, the part is currently backordered. We will keep the order open and text you when it ships.",
        variables: ["customerName"],
      },
      {
        name: "Special order follow-up",
        department: Department.PARTS,
        body: "Hi {{customerName}}, checking in on your special order. Reply if you want us to keep it active or make any changes.",
        variables: ["customerName"],
      },
      {
        name: "Missed call response",
        department: Department.GENERAL,
        body: "Hi {{customerName}}, sorry we missed your call. How can we help today?",
        variables: ["customerName"],
      },
      {
        name: "Review request",
        department: Department.GENERAL,
        body: "Hi {{customerName}}, thanks for choosing {{dealershipName}}. If we earned it, we would appreciate a quick review.",
        variables: ["customerName", "dealershipName"],
      },
      {
        name: "Holiday hours",
        department: Department.GENERAL,
        body: "Hi {{customerName}}, {{dealershipName}} holiday hours are updated. Reply here if you need sales, service, or parts help.",
        variables: ["customerName", "dealershipName"],
      },
    ],
  });

  const customerData = [
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
      ] as const,
      task: "Send Panigale V4 OTD quote",
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
  ];

  for (const entry of customerData) {
    const customer = await prisma.customer.upsert({
      where: { phone: entry.phone },
      update: {
        name: entry.name,
        email: entry.email,
        preferredContactMethod: PreferredContactMethod.SMS,
      },
      create: {
        name: entry.name,
        phone: entry.phone,
        email: entry.email,
        preferredContactMethod: PreferredContactMethod.SMS,
        optedInAt: daysFromNow(-30),
        notes: `${entry.name} is part of the ${dealershipName} demo workflow.`,
      },
    });

    await prisma.customerVehicle.deleteMany({ where: { customerId: customer.id } });
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

    await prisma.conversation.deleteMany({ where: { customerId: customer.id } });
    const conversation = await prisma.conversation.create({
      data: {
        customerId: customer.id,
        assignedUserId: entry.assignedUserId,
        department: entry.department,
        priority: entry.priority,
        status: entry.status,
        subject: entry.subject,
        unread: entry.messages.at(-1)?.[0] === MessageDirection.INBOUND,
        lastMessageAt: hoursFromNow(-entry.messages.length),
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
          createdAt: hoursFromNow(-entry.messages.length + index),
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
        status: TaskStatus.OPEN,
      },
    });

    await prisma.optInEvent.create({
      data: {
        customerId: customer.id,
        type: OptInEventType.OPT_IN,
        source: "seed",
      },
    });
  }

  const seededConversations = await prisma.conversation.findMany({
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
