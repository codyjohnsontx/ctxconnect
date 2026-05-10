import { Department } from "../src/generated/prisma/client";

export const defaultDealershipSettings = {
  id: "default",
  dealershipName: "CTX MotoWorks",
  salesPhone: "+15125550150",
  servicePhone: "+15125550160",
  partsPhone: "+15125550170",
  websiteUrl: "https://ctxmotoworks.example.com",
};

export const defaultTagData = [
  ["Hot lead", "#dc2626"],
  ["Pickup ready", "#16a34a"],
  ["Needs approval", "#d97706"],
  ["Financing", "#2563eb"],
  ["Trade-in", "#7c3aed"],
  ["Parts delay", "#0891b2"],
] as const;

export const defaultTemplateData = [
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
];
