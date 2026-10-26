import { notFound } from "next/navigation";
import { InboxView } from "@/components/inbox-view";
import { getInboxData } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { previewSendBlock } from "@/lib/sms-send";

export const dynamic = "force-dynamic";

// `Run pass` is a Server Action hosted by this route too, so it carries the same
// budget as /inbox. See the ambient pass notes in the README.
export const maxDuration = 300;

type PageProps = {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function ConversationPage({ params, searchParams }: PageProps) {
  const user = await requireUser();
  const { conversationId } = await params;
  const query = await searchParams;
  const data = await getInboxData(user, query, conversationId);

  if (!data.selectedConversation) {
    notFound();
  }

  // The gate's dry run, from the same reads the send makes; the send decides again.
  const sendBlock = await previewSendBlock({
    customerId: data.selectedConversation.customerId,
    conversationId,
  });

  return (
    <InboxView
      {...data}
      selectedId={conversationId}
      searchParams={query}
      isDemo={Boolean(user.isDemo)}
      currentUser={user}
      sendBlock={sendBlock}
    />
  );
}
