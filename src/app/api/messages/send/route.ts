import { NextResponse } from "next/server";
import { z } from "zod";
import { smsTooLong } from "@/lib/sms-length";
import { sendCustomerText } from "@/lib/sms-send";
import { requireConversationAccess } from "@/lib/permissions";
import { getActiveSessionUser } from "@/lib/session";

// The length limit is checked after parsing rather than inside the schema, so a
// reply that is merely too long gets a sentence naming how much to cut instead
// of the same "invalid payload" a malformed request gets.
const sendSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const user = await getActiveSessionUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (user.isDemo) {
    return NextResponse.json(
      { error: "Demo mode: outbound SMS is disabled. Everything else is live." },
      { status: 403 },
    );
  }

  const parsed = sendSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid message payload." }, { status: 400 });
  }

  const tooLong = smsTooLong(parsed.data.body);

  if (tooLong) {
    return NextResponse.json({ error: tooLong.message }, { status: 400 });
  }

  let conversation;

  try {
    conversation = await requireConversationAccess(user, parsed.data.conversationId);
  } catch (error) {
    if (error instanceof Error && error.message === "Conversation not found.") {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    if (error instanceof Error && error.message === "Conversation access denied.") {
      return NextResponse.json({ error: "Conversation access denied." }, { status: 403 });
    }

    console.error("Failed to authorize message send.", {
      conversationId: parsed.data.conversationId,
      userId: user.id,
      error,
    });
    return NextResponse.json({ error: "Failed to load conversation." }, { status: 500 });
  }

  // Everything past the access guard - the consent gate, the write it
  // licenses and the one call to Twilio - is the single send path.
  const outcome = await sendCustomerText({ userId: user.id, conversation, body: parsed.data.body });

  return NextResponse.json(outcome.payload, { status: outcome.status });
}
