import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { InboxView } from "@/components/inbox-view";
import { authOptions } from "@/lib/auth";
import { getInboxData } from "@/lib/data";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function ConversationPage({ params, searchParams }: PageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const { conversationId } = await params;
  const query = await searchParams;
  const data = await getInboxData(session.user, query, conversationId);

  if (!data.selectedConversation) {
    notFound();
  }

  return (
    <InboxView
      {...data}
      selectedId={conversationId}
      searchParams={query}
      isDemo={Boolean(session.user.isDemo)}
    />
  );
}
