import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import { Department, PrismaClient, Role } from "../src/generated/prisma/client";
import {
  defaultDealershipSettings,
  defaultTagData,
  defaultTemplateData,
} from "./baseline-data";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to bootstrap production.");
}

const adminName = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();

if (!adminName || !adminEmail || !adminPassword) {
  throw new Error(
    "BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, and BOOTSTRAP_ADMIN_PASSWORD are required to bootstrap production.",
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function getBootstrapAdmin() {
  if (!adminName || !adminEmail || !adminPassword) {
    throw new Error(
      "BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, and BOOTSTRAP_ADMIN_PASSWORD are required to bootstrap production.",
    );
  }

  return {
    adminName,
    adminEmail,
    adminPassword,
  };
}

async function main() {
  const bootstrapAdmin = getBootstrapAdmin();
  const existingUsers = await prisma.user.count();

  if (existingUsers > 0) {
    throw new Error(
      "Production bootstrap expects an empty user table. Refusing to continue because staff users already exist.",
    );
  }

  const passwordHash = await hash(bootstrapAdmin.adminPassword, 12);

  await prisma.$transaction(async (tx) => {
    await tx.dealershipSettings.upsert({
      where: { id: defaultDealershipSettings.id },
      update: {},
      create: defaultDealershipSettings,
    });

    await tx.user.create({
      data: {
        name: bootstrapAdmin.adminName,
        email: bootstrapAdmin.adminEmail,
        passwordHash,
        role: Role.ADMIN,
        department: Department.GENERAL,
      },
    });

    for (const [name, color] of defaultTagData) {
      await tx.tag.upsert({
        where: { name },
        update: { color },
        create: { name, color },
      });
    }

    await tx.template.createMany({
      data: [...defaultTemplateData],
      skipDuplicates: true,
    });
  });

  console.log(`Bootstrapped production defaults for ${defaultDealershipSettings.dealershipName}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
