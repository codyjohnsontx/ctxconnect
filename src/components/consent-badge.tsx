import { Badge } from "@/components/ui/badge";
import type { ConsentDescription } from "@/lib/consent";

/** The short form of `describeConsent`, wherever a customer is listed or headed. */
export function ConsentBadge({ consent }: { consent: Pick<ConsentDescription, "tone" | "label"> }) {
  return <Badge variant={consent.tone}>{consent.label}</Badge>;
}
