import Link from "next/link";
import { ConsentBadge } from "@/components/consent-badge";
import { cachedConsentState, describeConsent } from "@/lib/consent";
import { describeOtherDepartments } from "@/lib/conversation-access";
import { getCustomers } from "@/lib/data";
import { requireUser } from "@/lib/session";
import { formatPhone, labelize } from "@/lib/utils";

export const dynamic = "force-dynamic";

// One bordered card: a column rule on top, then rows sharing a hairline. On a
// phone the columns stack and the rule goes, so the cells say what they are.
const columns = "md:grid-cols-[1.2fr_1fr_1fr_1fr]";
const rowClassName = `grid gap-1 border-b border-border px-4 py-3 last:border-0 md:items-center md:gap-3 ${columns}`;

export default async function CustomersPage() {
  const user = await requireUser();
  const customers = await getCustomers(user);

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-4 text-600 font-semibold tracking-tight">Customers</h1>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <div className={`grid border-b border-border px-4 py-2 text-200 font-medium text-text-muted max-md:hidden ${columns}`}>
          <span>Customer</span>
          <span>Unit</span>
          <span>Latest status</span>
          <span>SMS consent</span>
        </div>
        {customers.map((customer) => {
          // Scoped by getCustomers to the threads this reader can open, so the
          // row never links somewhere she would be turned away from.
          const latest = customer.conversations[0];
          const vehicle = customer.vehicles[0];
          const elsewhere = describeOtherDepartments(customer.otherDepartments);
          const cells = (
            <>
              <div className="min-w-0">
                <div className="font-medium">{customer.name}</div>
                <div className="text-200 text-text-muted">{formatPhone(customer.phone)}</div>
              </div>
              <div className="text-text-muted">
                {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "No unit linked"}
              </div>
              <div className="text-text-muted">
                {latest ? `${labelize(latest.department)} · ${labelize(latest.status)}` : "No conversation yet"}
                {elsewhere ? <div className="text-200 text-text-faint">{elsewhere}</div> : null}
              </div>
              <div>
                <ConsentBadge consent={describeConsent(cachedConsentState(customer))} />
              </div>
            </>
          );

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
              className={`${rowClassName} transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-focus-ring`}
            >
              {cells}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
