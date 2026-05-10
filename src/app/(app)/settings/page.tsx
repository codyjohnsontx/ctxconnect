import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import {
  createStaffUser,
  resetStaffPassword,
  updateDealershipSettings,
  updateStaffUserStatus,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { Department, Role } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import { getSettingsData } from "@/lib/data";
import { getRequiredEnvironmentNames } from "@/lib/env";
import { isAdmin, isManagerOrAdmin } from "@/lib/permissions";
import { labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

const roles = Object.values(Role);
const departments = Object.values(Department);

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !isManagerOrAdmin(session.user)) {
    redirect("/inbox");
  }

  const { users, dealershipSettings, health } = await getSettingsData();
  const admin = isAdmin(session.user);

  return (
    <div className="p-5 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Operations readiness for staff accounts, integration health, and dealership defaults.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
        <div className="space-y-4">
          <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Staff account management</h2>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    Admins can create staff accounts, change access, and reset passwords.
                  </p>
                </div>
                <Badge variant={admin ? "blue" : "neutral"}>{admin ? "Admin controls enabled" : "Read only"}</Badge>
              </div>
            </div>

            {admin ? (
              <form action={createStaffUser} className="grid gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 md:grid-cols-2">
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

            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {users.map((user) => (
                <div key={user.id} className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{user.name}</div>
                        <Badge variant={user.active ? "green" : "red"}>{user.active ? "Active" : "Inactive"}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{user.email}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge>{labelize(user.role)}</Badge>
                        {user.department ? <Badge>{labelize(user.department)}</Badge> : null}
                      </div>
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
                          <div className="w-full space-y-1.5">
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

          <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="font-semibold">Dealership identity defaults</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Values used in templates and operator messaging context.
              </p>
            </div>

            {admin ? (
              <form action={updateDealershipSettings} className="grid gap-3 p-4 md:grid-cols-2">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="dealershipName">Dealership name</Label>
                  <Input id="dealershipName" name="dealershipName" defaultValue={dealershipSettings.dealershipName} required />
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
              <div className="grid gap-3 p-4 md:grid-cols-2">
                <ReadField label="Dealership name" value={dealershipSettings.dealershipName} />
                <ReadField label="Sales phone" value={dealershipSettings.salesPhone ?? "Not set"} />
                <ReadField label="Service phone" value={dealershipSettings.servicePhone ?? "Not set"} />
                <ReadField label="Parts phone" value={dealershipSettings.partsPhone ?? "Not set"} />
                <ReadField label="Website URL" value={dealershipSettings.websiteUrl ?? "Not set"} />
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-semibold">Integration health</h2>
            <div className="mt-4 space-y-3">
              <HealthCard
                label="Database"
                status={health.database.status}
                detail={health.database.detail}
              />
              <HealthCard label="Auth.js credentials" status={health.auth.status} detail={health.auth.detail} />
              <HealthCard label="Twilio" status={health.twilio.status} detail={health.twilio.detail} />
              {health.twilio.latestFailure ? (
                <div className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
                  Latest delivery issue: {health.twilio.latestFailure}
                </div>
              ) : null}
              <HealthCard label="Public app URL" status={health.app.status} detail={health.app.detail} />
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-semibold">Required environment</h2>
            <div className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
              {getRequiredEnvironmentNames().map((name) => (
                <div key={name} className="rounded bg-zinc-50 px-3 py-2 font-mono text-xs dark:bg-zinc-950">
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
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium">{label}</div>
        <Badge variant={status === "healthy" ? "green" : "red"}>{status === "healthy" ? "Healthy" : "Needs setup"}</Badge>
      </div>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{detail}</p>
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">{value}</div>
    </div>
  );
}
