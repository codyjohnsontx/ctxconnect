import { NextResponse } from "next/server";

export function conversationAccessErrorResponse(error: unknown) {
  if (error instanceof Error && error.message === "Conversation not found.") {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  if (error instanceof Error && error.message === "Conversation access denied.") {
    return NextResponse.json({ error: "Conversation access denied." }, { status: 403 });
  }

  return null;
}
