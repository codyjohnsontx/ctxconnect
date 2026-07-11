import { InboxView } from "@/components/inbox-view";
import { getInboxData } from "@/lib/data";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function InboxPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;
  const data = await getInboxData(user, params);

  return <InboxView {...data} searchParams={params} isDemo={Boolean(user.isDemo)} />;
}
