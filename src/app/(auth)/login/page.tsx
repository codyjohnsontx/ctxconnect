import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { authOptions } from "@/lib/auth";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect("/inbox");
  }

  return (
    <main className="grid min-h-dvh bg-zinc-950 text-white lg:grid-cols-[1fr_460px]">
      <section className="hidden min-h-dvh flex-col justify-between border-r border-white/10 p-10 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-white text-sm font-semibold text-zinc-950">
            CTX
          </div>
          <div>
            <div className="text-sm font-semibold">CTX Chat</div>
            <div className="text-xs text-zinc-400">Single-store dealership communication</div>
          </div>
        </div>
        <div className="max-w-xl">
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-zinc-500">Command center</p>
          <h1 className="text-5xl font-semibold tracking-tight">
            Shared texting, follow-ups, and service lane status in one place.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-zinc-300">
            Built for busy motorcycle dealership teams that need customers, units, RO context,
            assignments, and next actions visible without chasing five systems.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm text-zinc-300">
          <div>
            <div className="text-2xl font-semibold text-white">8</div>
            Seeded conversations
          </div>
          <div>
            <div className="text-2xl font-semibold text-white">5</div>
            Staff roles
          </div>
          <div>
            <div className="text-2xl font-semibold text-white">17</div>
            Reply templates
          </div>
        </div>
      </section>
      <section className="flex min-h-dvh items-center justify-center bg-zinc-50 p-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-zinc-950 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
              CTX
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">CTX Chat</h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Dealership communication workspace</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-xl font-semibold">Sign in</h2>
            <p className="mb-6 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Use a seeded staff account to open the MVP.</p>
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
          <div className="mt-4 flex items-center justify-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
            <Link href="/privacy-policy" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
              Privacy Policy
            </Link>
            <span>•</span>
            <Link href="/terms-and-conditions" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
              Terms &amp; Conditions
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
