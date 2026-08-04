import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedDemoData } from "../src/lib/demo-seed";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to seed Attend.");
}

const seedConnectionString = connectionString;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: seedConnectionString }),
});

const demoSeedAllowFlag = "ATTEND_ALLOW_DEMO_SEED";

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
    `Refusing to seed Attend because DIRECT_URL/DATABASE_URL does not look local or non-production. Set ${demoSeedAllowFlag}=true only for intentional local/demo seeding.`,
  );
}

async function main() {
  assertSafeSeedTarget();
  await seedDemoData(prisma);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
