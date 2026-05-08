import { getServerSession } from "next-auth";
import { InboxView } from "@/components/inbox-view";
import { authOptions } from "@/lib/auth";
import { getInboxData } from "@/lib/data";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function InboxPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const params = await searchParams;
  const data = await getInboxData(session!.user, params);

  return <InboxView {...data} searchParams={params} />;
}
