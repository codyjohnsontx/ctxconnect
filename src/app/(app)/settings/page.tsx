import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createStaffUser,
  resetStaffPassword,
  updateDealershipSettings,
  updateStaffUserStatus,
} from "@/app/actions";
import { LocalTimestamp } from "@/components/local-timestamp";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/section-header";
import { Department, Role } from "@/generated/prisma/client";
import { describeThreadsOffCoverage, threadsOffCoverage } from "@/lib/coverage";
import { getSettingsData } from "@/lib/data";
import { getRequiredEnvironmentNames } from "@/lib/env";
import { isAdmin, isManagerOrAdmin } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { cn, labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

const roles = Object.values(Role);
const departments = Object.values(Department);

// Every block on the page is one bordered card with a header rule, as the
// Command Center lays its sections out.
const cardClass = "rounded-md border border-border bg-surface";
const cardHeaderClass = "border-b border-border px-4 py-2";
// The one link style for leaving a sentence, as the inbox spells it.
const linkClass = "font-medium text-accent underline-offset-2 hover:underline";

export default async function SettingsPage() {
  const user = await requireUser();

  if (!isManagerOrAdmin(user)) {
    redirect("/inbox");
  }

  const { users, dealershipSettings, health } = await getSettingsData();
  const admin = isAdmin(user);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-600 font-semibold tracking-tight">Settings</h1>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
        <div className="space-y-4">
          <section className={cardClass}>
            <div className={cardHeaderClass}>
              <SectionHeader
                as="h2"
                title="Staff account management"
                trailing={<Badge>{admin ? "Admin controls enabled" : "Read only"}</Badge>}
              />
            </div>

            {admin ? (
              <form action={createStaffUser} className="grid gap-3 border-b border-border p-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Temporary password</Label>
                  <Input id="password" name="password" type="password" minLength={8} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role">Role</Label>
                  <Select id="role" name="role" defaultValue={Role.SALES}>
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {labelize(role)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="department">Department</Label>
                  <Select id="department" name="department" defaultValue={Department.SALES}>
                    {departments.map((department) => (
                      <option key={department} value={department}>
                        {labelize(department)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button type="submit" className="w-full">
                    Create staff user
                  </Button>
                </div>
              </form>
            ) : null}

            <div className="divide-y divide-border">
              {users.map((user) => (
                <div key={user.id} className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{user.name}</div>
                        <Badge variant={user.active ? "success" : "critical"}>{user.active ? "Active" : "Inactive"}</Badge>
                        <Badge>{labelize(user.role)}</Badge>
                        {user.department ? <Badge>{labelize(user.department)}</Badge> : null}
                      </div>
                      <div className="mt-1 text-200 text-text-muted">{user.email}</div>
                      {user.active ? null : <AccessRecord accessEndedAt={user.accessEndedAt} lastSeenAt={user.lastSeenAt} />}
                      <OpenConversations
                        id={user.id}
                        active={user.active}
                        openConversations={user.openConversations}
                        coveredThreads={user.coveredThreads}
                        coveredBy={user.coveredBy}
                      />
                    </div>

                    {admin ? (
                      <div className="grid gap-2 sm:min-w-[320px]">
                        <form action={updateStaffUserStatus} className="flex gap-2">
                          <input type="hidden" name="userId" value={user.id} />
                          <input type="hidden" name="active" value={user.active ? "false" : "true"} />
                          <Button type="submit" variant="secondary" className="w-full">
                            {user.active ? "Deactivate" : "Reactivate"}
                          </Button>
                        </form>
                        <form action={resetStaffPassword} className="flex gap-2">
                          <input type="hidden" name="userId" value={user.id} />
                          <div className="w-full">
                            <Label htmlFor={`reset-password-${user.id}`} className="sr-only">
                              New password for {user.name}
                            </Label>
                            <Input
                              id={`reset-password-${user.id}`}
                              name="password"
                              type="password"
                              minLength={8}
                              placeholder="New password"
                              required
                            />
                          </div>
                          <Button type="submit" variant="secondary">
                            Reset
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={cardClass}>
            <div className={cardHeaderClass}>
              <SectionHeader as="h2" title="Dealership identity defaults" />
            </div>

            {admin ? (
              <form action={updateDealershipSettings} className="grid gap-3 p-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="dealershipName">Dealership name</Label>
                  <Input id="dealershipName" name="dealershipName" defaultValue={dealershipSettings.dealershipName ?? ""} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="salesPhone">Sales phone</Label>
                  <Input id="salesPhone" name="salesPhone" defaultValue={dealershipSettings.salesPhone ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="servicePhone">Service phone</Label>
                  <Input id="servicePhone" name="servicePhone" defaultValue={dealershipSettings.servicePhone ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="partsPhone">Parts phone</Label>
                  <Input id="partsPhone" name="partsPhone" defaultValue={dealershipSettings.partsPhone ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="websiteUrl">Website URL</Label>
                  <Input id="websiteUrl" name="websiteUrl" defaultValue={dealershipSettings.websiteUrl ?? ""} />
                </div>
                <div className="md:col-span-2">
                  <Button type="submit">Save dealership defaults</Button>
                </div>
              </form>
            ) : (
              // Read-only: the same facts as a key/value list, the way the
              // thread panel prints a customer's details.
              <dl className="grid gap-x-4 gap-y-1 p-4 sm:grid-cols-[auto_minmax(0,1fr)]">
                <ReadField label="Dealership name" value={dealershipSettings.dealershipName ?? "Not set"} />
                <ReadField label="Sales phone" value={dealershipSettings.salesPhone ?? "Not set"} />
                <ReadField label="Service phone" value={dealershipSettings.servicePhone ?? "Not set"} />
                <ReadField label="Parts phone" value={dealershipSettings.partsPhone ?? "Not set"} />
                <ReadField label="Website URL" value={dealershipSettings.websiteUrl ?? "Not set"} />
              </dl>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className={cardClass}>
            <div className={cardHeaderClass}>
              <SectionHeader as="h2" title="Integration health" />
            </div>
            <div className="space-y-3 p-4">
              <HealthCard
                label="Database"
                status={health.database.status}
                detail={health.database.detail}
              />
              <HealthCard label="Auth.js credentials" status={health.auth.status} detail={health.auth.detail} />
              <HealthCard label="Twilio" status={health.twilio.status} detail={health.twilio.detail} />
              {health.twilio.latestFailure ? (
                <Alert variant="critical" inline>
                  Latest delivery issue: {health.twilio.latestFailure}
                </Alert>
              ) : null}
              <HealthCard label="Public app URL" status={health.app.status} detail={health.app.detail} />
            </div>
          </section>

          <section className={cardClass}>
            <div className={cardHeaderClass}>
              <SectionHeader as="h2" title="Required environment" />
            </div>
            <div className="space-y-1 p-4">
              {getRequiredEnvironmentNames().map((name) => (
                <div key={name} className="rounded-sm bg-surface-raised px-2 py-1 font-mono text-200 text-text-muted">
                  {name}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * What is still on this account, and whether anyone is reading it.
 *
 * Switching an account off ends its access and stops there - by design, so that
 * one decision does not quietly become two. The conversations stay where they
 * were, which is the state this line exists to make impossible to miss: an
 * admin who has just deactivated somebody is one click from arranging cover
 * for the customers still waiting on them.
 */
function OpenConversations({
  id,
  active,
  openConversations,
  coveredThreads,
  coveredBy,
}: {
  id: string;
  active: boolean;
  openConversations: number;
  coveredThreads: Array<{ heldBy: { id: string } | null }>;
  coveredBy: { id: string; name: string } | null;
}) {
  if (coveredBy) {
    const offCoverage = threadsOffCoverage(id, openConversations, coveredThreads);
    const stillOnTheAccount = describeThreadsOffCoverage(offCoverage, active, false);

    return (
      <p className={cn("mt-2 text-200", stillOnTheAccount && !active ? "text-warning" : "text-text-muted")}>
        Conversations covered by {coveredBy.name}.
        {stillOnTheAccount ? ` ${stillOnTheAccount}` : ""}{" "}
        <Link href="/coverage" className={linkClass}>
          Coverage
        </Link>
      </p>
    );
  }

  if (openConversations === 0) {
    return null;
  }

  const stranded = !active;

  return (
    <p className={cn("mt-2 text-200", stranded ? "text-warning" : "text-text-muted")}>
      {openConversations} open {openConversations === 1 ? "conversation" : "conversations"}
      {stranded
        ? `, and nobody is reading ${openConversations === 1 ? "it" : "them"}.`
        : "."}{" "}
      <Link href="/coverage" className={linkClass}>
        {stranded ? "Arrange cover" : "Coverage"}
      </Link>
    </p>
  );
}

/**
 * What deactivating an account actually did, for the admin who pressed the
 * button. Two facts, no judgement: when this account's sessions stopped being
 * accepted, and when it was last granted a request.
 *
 * The labels say "granted" because that is all the second number knows. A
 * refused request is not recorded, so an account that has been turned away
 * fifty times since the cutoff reads exactly the same as one nobody has
 * touched; an admin must not read quiet where there was only refusal.
 */
function AccessRecord({ accessEndedAt, lastSeenAt }: { accessEndedAt: Date | null; lastSeenAt: Date | null }) {
  return (
    <dl className="mt-2 space-y-0.5 text-200 text-text-muted">
      <div className="flex flex-wrap gap-x-1.5">
        <dt>Access ended</dt>
        {/* Null for accounts switched off before the cutoff was recorded. */}
        <dd className="text-text">
          {accessEndedAt ? <LocalTimestamp value={accessEndedAt} /> : "Not recorded"}
        </dd>
      </div>
      <div className="flex flex-wrap gap-x-1.5">
        <dt>Last granted request</dt>
        {/* Refused requests are not recorded, so "none" means none were let through. */}
        <dd className="text-text">
          {lastSeenAt ? <LocalTimestamp value={lastSeenAt} /> : "None granted"}
        </dd>
      </div>
    </dl>
  );
}

function HealthCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: "healthy" | "unhealthy";
  detail: string;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium">{label}</div>
        <Badge variant={status === "healthy" ? "success" : "critical"}>{status === "healthy" ? "Healthy" : "Needs setup"}</Badge>
      </div>
      <p className="mt-1 text-200 text-text-muted">{detail}</p>
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-muted sm:whitespace-nowrap">{label}</dt>
      <dd className="min-w-0 break-words max-sm:mb-2">{value}</dd>
    </>
  );
}
