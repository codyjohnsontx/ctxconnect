import { Badge } from "@/components/ui/badge";
import { getSettingsData } from "@/lib/data";
import { labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const users = await getSettingsData();

  return (
    <div className="p-5 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">MVP staff and integration configuration reference.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-semibold">Staff users</h2>
          </div>
          <div className="divide-y divide-zinc-100">
            {users.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">{user.email}</div>
                </div>
                <div className="flex gap-2">
                  <Badge>{labelize(user.role)}</Badge>
                  {user.department ? <Badge>{labelize(user.department)}</Badge> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="font-semibold">Required environment</h2>
          <div className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
            {[
              "DATABASE_URL",
              "NEXTAUTH_SECRET",
              "NEXTAUTH_URL",
              "TWILIO_ACCOUNT_SID",
              "TWILIO_AUTH_TOKEN",
              "TWILIO_PHONE_NUMBER",
              "TWILIO_MESSAGING_SERVICE_SID",
              "NEXT_PUBLIC_APP_URL",
            ].map((name) => (
              <div key={name} className="rounded bg-zinc-50 px-3 py-2 font-mono text-xs dark:bg-zinc-950">
                {name}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
