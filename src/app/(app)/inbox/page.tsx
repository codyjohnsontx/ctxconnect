import { InboxView } from "@/components/inbox-view";
import { getInboxData } from "@/lib/data";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

// `Run pass` is a Server Action hosted by this route, so its invocation has to
// cover AI_PASS_MAX_BRIEFS sequential model calls. Same budget as the cron
// routes that run the identical pass. See the ambient pass notes in the README.
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function InboxPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;
  const data = await getInboxData(user, params);

  return <InboxView {...data} searchParams={params} isDemo={Boolean(user.isDemo)} />;
}
