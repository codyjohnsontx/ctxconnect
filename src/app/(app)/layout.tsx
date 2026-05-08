import type { ReactNode } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { authOptions } from "@/lib/auth";
import { getShellData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const shellData = await getShellData(session.user);

  return (
    <AppShell user={session.user} shellData={shellData}>
      {children}
    </AppShell>
  );
}
