import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { describeOtherDepartments } from "@/lib/conversation-access";
import { getCustomers } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { formatPhone, labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await requireUser();
  const customers = await getCustomers(user);

  return (
    <div className="p-5 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Customer profiles with linked units and latest conversation context.</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] border-b border-zinc-200 px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400 max-md:hidden">
          <span>Customer</span>
          <span>Unit</span>
          <span>Latest status</span>
          <span>Opt status</span>
        </div>
        {customers.map((customer) => {
          // Scoped by getCustomers to the threads this reader can open, so the
          // row never links somewhere she would be turned away from.
          const latest = customer.conversations[0];
          const vehicle = customer.vehicles[0];
          const elsewhere = describeOtherDepartments(customer.otherDepartments);
          const cells = (
            <>
              <div>
                <div className="font-medium">{customer.name}</div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">{formatPhone(customer.phone)}</div>
              </div>
              <div className="text-sm text-zinc-600 dark:text-zinc-300">
                {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "No unit linked"}
              </div>
              <div className="text-sm text-zinc-600 dark:text-zinc-300">
                {latest ? `${labelize(latest.department)} · ${labelize(latest.status)}` : "No conversation yet"}
                {elsewhere ? (
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{elsewhere}</div>
                ) : null}
              </div>
              <div>
                <Badge variant={customer.smsOptedOut ? "red" : "green"}>{customer.smsOptedOut ? "Opted out" : "SMS ok"}</Badge>
              </div>
            </>
          );
          const rowClassName =
            "grid gap-3 border-b border-zinc-100 p-4 last:border-0 dark:border-zinc-800 md:grid-cols-[1.2fr_1fr_1fr_1fr] md:items-center";

          // Nothing to open: a row that links to the bare inbox looks like a
          // dead click, so it stops being a link at all.
          if (!latest) {
            return (
              <div key={customer.id} className={rowClassName}>
                {cells}
              </div>
            );
          }

          return (
            <Link
              key={customer.id}
              href={`/inbox/${latest.id}?from=customers`}
              className={`${rowClassName} hover:bg-zinc-50 dark:hover:bg-zinc-800`}
            >
              {cells}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
