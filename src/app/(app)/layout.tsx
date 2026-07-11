import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getShellData } from "@/lib/data";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const shellData = await getShellData(user);

  return (
    <AppShell user={user} shellData={shellData}>
      {children}
    </AppShell>
  );
}
