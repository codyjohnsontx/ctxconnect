import OpenAI from "openai";
import { z } from "zod";
import {
  ConversationStatus,
  DeliveryStatus,
  Department,
  MessageDirection,
  Priority,
  TaskStatus,
} from "@/generated/prisma/client";

export type AiOpsBriefInput = {
  dealershipName: string;
  conversation: {
    id: string;
    department: Department;
    status: ConversationStatus;
    priority: Priority;
    subject: string | null;
    customer: {
      name: string;
      smsOptedOut: boolean;
      notes: string | null;
    };
    messages: Array<{
      direction: MessageDirection;
      body: string;
      deliveryStatus: DeliveryStatus;
      createdAt: Date;
      senderName?: string | null;
    }>;
    tasks: Array<{
      title: string;
      dueDate: Date;
      status: TaskStatus;
      priority: Priority;
    }>;
  };
};

export type AiOpsBriefResult = {
  summary: string;
  customerNeed: string;
  riskLevel: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  riskReasons: string[];
  escalationRecommended: boolean;
  escalationReason: string | null;
  suggestedDepartment: Department | null;
  suggestedNextAction: string;
  suggestedReply: string | null;
  suggestedTaskTitle: string | null;
  confidence: number;
};

const aiOpsBriefSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  customerNeed: z.string().trim().min(1).max(400),
  riskLevel: z.enum([Priority.LOW, Priority.NORMAL, Priority.HIGH, Priority.URGENT]),
  riskReasons: z.array(z.string().trim().min(1).max(180)).max(6),
  escalationRecommended: z.boolean(),
  escalationReason: z.string().trim().min(1).max(300).nullable(),
  suggestedDepartment: z.enum([
    Department.SALES,
    Department.SERVICE,
    Department.PARTS,
    Department.FINANCE,
    Department.GENERAL,
  ]).nullable(),
  suggestedNextAction: z.string().trim().min(1).max(400),
  suggestedReply: z.string().trim().min(1).max(700).nullable(),
  suggestedTaskTitle: z.string().trim().min(1).max(140).nullable(),
  confidence: z.number().int().min(0).max(100),
});

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    customerNeed: { type: "string" },
    riskLevel: { type: "string", enum: Object.values(Priority) },
    riskReasons: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    escalationRecommended: { type: "boolean" },
    escalationReason: { type: ["string", "null"] },
    suggestedDepartment: { type: ["string", "null"], enum: [...Object.values(Department), null] },
    suggestedNextAction: { type: "string" },
    suggestedReply: { type: ["string", "null"] },
    suggestedTaskTitle: { type: ["string", "null"] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
  },
  required: [
    "summary",
    "customerNeed",
    "riskLevel",
    "riskReasons",
    "escalationRecommended",
    "escalationReason",
    "suggestedDepartment",
    "suggestedNextAction",
    "suggestedReply",
    "suggestedTaskTitle",
    "confidence",
  ],
} as const;

function normalizeInput(input: AiOpsBriefInput) {
  return {
    dealershipName: input.dealershipName,
    generatedAt: new Date().toISOString(),
    conversation: {
      ...input.conversation,
      messages: input.conversation.messages.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
      tasks: input.conversation.tasks.map((task) => ({
        ...task,
        dueDate: task.dueDate.toISOString(),
      })),
    },
  };
}

function sanitizeSmsOptOut(input: AiOpsBriefInput, result: AiOpsBriefResult): AiOpsBriefResult {
  if (!input.conversation.customer.smsOptedOut) {
    return result;
  }

  return {
    ...result,
    suggestedNextAction: "Use a non-SMS channel before any customer outreach because the customer is opted out.",
    suggestedReply: null,
  };
}

/**
 * Strips anything shaped like an API key out of provider error text before it is
 * logged or persisted. Providers echo a masked key in 401 bodies; nothing that
 * looks like a credential should reach a log line or a database row.
 *
 * Covers the three shapes that actually appear: an OpenAI `sk-` key, a Bearer
 * fragment from a gateway or proxy, and a long opaque token from an Azure or
 * OpenAI-compatible deployment. The opaque pattern is deliberately long and
 * mixed-case-or-digit so ordinary error prose survives unredacted, and request
 * ids are kept: they are how a failure is traced back to the provider, and they
 * are not credentials.
 *
 * The `sk-` pattern is anchored at a word boundary so it cannot fire inside an
 * ordinary word: a key starts a word, so `risk-level` and `task-id` are not
 * keys. It redacts every match, because how innocent a value looks says nothing
 * about whether it is a credential. What follows `Bearer` is kept only when it
 * is one of the prose words below, and redacted otherwise, for the same reason.
 */
export function redactProviderSecrets(message: string) {
  return message
    .replace(/\bsk-[A-Za-z0-9_*-]+/g, "sk-[redacted]")
    .replace(/(Bearer\s+)(\S+)/gi, (match, scheme: string, value: string) =>
      BEARER_PROSE_WORDS.has(value.toLowerCase()) ? match : `${scheme}[redacted]`,
    )
    .replace(
      /\b(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g,
      (token, offset: number, full: string) =>
        isRequestId(token, full.slice(0, offset)) ? token : "[redacted]",
    );
}

/**
 * Every value that may follow `Bearer` and survive. The list is closed and
 * matched exactly: an unrecognised value is redacted, so a credential that reads
 * like ordinary prose is still treated as one. A token that is literally the
 * word `token` was never a secret.
 */
const BEARER_PROSE_WORDS = new Set([
  "token",
  "header",
  "auth",
  "missing",
  "required",
  "invalid",
  "expired",
]);

function isRequestId(token: string, precedingText: string) {
  return /^req(uest)?[-_]/i.test(token) || /request[-_ ]?id["']?\s*[:=]\s*$/i.test(precedingText);
}

export function getAiOpsBriefModel() {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
}

export function isAiOpsBriefConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Per-call ceiling on the provider request.
 *
 * Exported because the ambient pass derives its own deadline from it: the pass
 * runs these calls one after another, so this is the longest a single brief can
 * hold the invocation. Raising it shortens the pass. See PASS_DEADLINE_MS in
 * src/lib/ai/ambient-pass.ts before changing it.
 */
export const AI_BRIEF_TIMEOUT_MS = 30_000;

/**
 * The `maxDuration` every route that hosts a loop of these calls declares:
 * /api/ai/sweep, /api/demo/reseed, /inbox and /inbox/[conversationId]. Changing
 * it there means changing it here.
 */
const INVOCATION_BUDGET_MS = 300_000;

/** Left for the database writes and the response after the last call returns. */
const RESPONSE_MARGIN_MS = 30_000;

/**
 * A whole provider timeout is subtracted because the last call a loop starts may
 * still run for one, so the deadline is derived rather than typed and stays
 * correct when either number moves.
 */
const BRIEF_BUDGET_DEADLINE_MS = INVOCATION_BUDGET_MS - AI_BRIEF_TIMEOUT_MS - RESPONSE_MARGIN_MS;

/**
 * Starts the clock for one invocation. The returned predicate says whether there
 * is still room to start another brief, so a caller asks before the call rather
 * than after, and reports what it managed once the answer is no.
 *
 * Two loops call generateAiOpsBrief one conversation at a time, and neither
 * count fits the invocation on its own: the ambient pass runs
 * AI_PASS_MAX_BRIEFS calls, 360 seconds at the defaults of 12 and 30, and the
 * seed regenerates its own written briefs, 270 seconds for nine of them before
 * the reseed's database work. Both share this rather than bounding their own
 * count against the budget separately, which would have to be redone every time
 * a count or a timeout changed.
 */
export function startBriefBudget() {
  const startedAt = Date.now();

  return () => Date.now() - startedAt < BRIEF_BUDGET_DEADLINE_MS;
}

export async function generateAiOpsBrief(input: AiOpsBriefInput): Promise<AiOpsBriefResult> {
  if (!isAiOpsBriefConfigured()) {
    throw new Error("OPENAI_API_KEY is required to generate an AI ops brief.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = getAiOpsBriefModel();

  const response = await client.responses.create(
    {
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are an operations assistant for a motorcycle dealership service advisor.",
                "Use only facts present in the supplied conversation context.",
                "Do not invent facts, promised actions, staff contact, customer contact, or outcomes.",
                "Do not claim the customer was contacted unless a message shows it.",
                "If the customer is opted out of SMS, suggestedReply must be null and suggestedNextAction must not recommend SMS.",
                "Treat failed messages, SLA misses, urgent priority, high priority, and overdue follow-ups as risk signals.",
                "Keep recommendations operational, specific, and human-approved.",
                "Return structured output only.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(normalizeInput(input), null, 2),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ai_ops_brief",
          strict: true,
          schema: responseJsonSchema,
        },
      },
    },
    { timeout: AI_BRIEF_TIMEOUT_MS },
  );

  const outputText = response.output_text;

  if (!outputText) {
    throw new Error("OpenAI returned an empty AI ops brief.");
  }

  // The model sometimes returns "" where the schema expects null; don't
  // reject an otherwise valid brief over an empty optional field.
  const raw = JSON.parse(outputText) as Record<string, unknown>;
  for (const field of ["escalationReason", "suggestedReply", "suggestedTaskTitle"]) {
    if (typeof raw[field] === "string" && (raw[field] as string).trim() === "") {
      raw[field] = null;
    }
  }

  const parsed = aiOpsBriefSchema.parse(raw);
  return sanitizeSmsOptOut(input, parsed);
}
