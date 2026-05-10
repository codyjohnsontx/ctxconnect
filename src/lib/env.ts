import { DeliveryStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const requiredEnvNames = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;

const twilioEnvNames = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
] as const;

export type IntegrationHealth = {
  database: {
    status: "healthy" | "unhealthy";
    detail: string;
  };
  auth: {
    status: "healthy" | "unhealthy";
    detail: string;
    missing: string[];
  };
  twilio: {
    status: "healthy" | "unhealthy";
    detail: string;
    missing: string[];
    recentFailures: number;
    latestFailure: string | null;
  };
  app: {
    status: "healthy" | "unhealthy";
    detail: string;
    missing: string[];
  };
};

function missingEnv(names: readonly string[]) {
  return names.filter((name) => !process.env[name]?.trim());
}

export function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

  return {
    accountSid,
    authToken,
    phoneNumber,
    messagingServiceSid,
    isConfigured: Boolean(accountSid && authToken && (phoneNumber || messagingServiceSid)),
  };
}

export function getRequiredEnvironmentNames() {
  return [...requiredEnvNames, ...twilioEnvNames];
}

export async function getIntegrationHealth(): Promise<IntegrationHealth> {
  let database: IntegrationHealth["database"] = {
    status: "healthy",
    detail: "Database connection is available.",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = {
      status: "unhealthy",
      detail: error instanceof Error ? error.message : "Database connection failed.",
    };
  }

  const authMissing = missingEnv(["NEXTAUTH_SECRET", "NEXTAUTH_URL"]);
  const appMissing = missingEnv(["NEXT_PUBLIC_APP_URL"]);
  const twilioConfig = getTwilioConfig();
  const twilioMissing = [
    ...missingEnv(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]),
    ...(!process.env.TWILIO_PHONE_NUMBER?.trim() && !process.env.TWILIO_MESSAGING_SERVICE_SID?.trim()
      ? ["TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID"]
      : []),
  ];

  let latestTwilioFailure: {
    conversation: { customer: { name: string } };
    errorMessage: string | null;
  } | null = null;
  let recentFailures = 0;

  if (database.status === "healthy") {
    try {
      latestTwilioFailure = await prisma.message.findFirst({
        where: {
          direction: "OUTBOUND",
          deliveryStatus: DeliveryStatus.FAILED,
        },
        orderBy: { updatedAt: "desc" },
        include: {
          conversation: { include: { customer: true } },
        },
      });

      recentFailures = await prisma.message.count({
        where: {
          direction: "OUTBOUND",
          deliveryStatus: DeliveryStatus.FAILED,
        },
      });
    } catch (error) {
      console.error("Failed to load Twilio delivery health metrics.", error);
    }
  }

  return {
    database,
    auth: {
      status: authMissing.length === 0 ? "healthy" : "unhealthy",
      detail:
        authMissing.length === 0
          ? "Credentials auth env is configured."
          : `Missing ${authMissing.join(", ")}.`,
      missing: authMissing,
    },
    twilio: {
      status: twilioConfig.isConfigured ? "healthy" : "unhealthy",
      detail: twilioConfig.isConfigured
        ? recentFailures > 0
          ? `${recentFailures} outbound message${recentFailures === 1 ? "" : "s"} currently marked failed.`
          : "Twilio credentials are configured and no failed outbound messages are recorded."
        : `Missing ${twilioMissing.join(", ")}.`,
      missing: twilioMissing,
      recentFailures,
      latestFailure: latestTwilioFailure
        ? `${latestTwilioFailure.conversation.customer.name}: ${latestTwilioFailure.errorMessage ?? "Delivery failed."}`
        : null,
    },
    app: {
      status: appMissing.length === 0 ? "healthy" : "unhealthy",
      detail:
        appMissing.length === 0
          ? "Public app URL is configured."
          : `Missing ${appMissing.join(", ")}.`,
      missing: appMissing,
    },
  };
}
