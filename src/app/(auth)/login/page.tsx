import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { getActiveSessionUser, INACTIVE_ACCOUNT_REASON, PASSWORD_CHANGED_REASON } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  // Resolved against the database, not the token: a deactivated account still
  // carries a session cookie, and bouncing it back to the inbox that just
  // rejected it would trap the person in a redirect loop.
  const user = await getActiveSessionUser();

  if (user) {
    redirect("/inbox");
  }

  const demoEnabled = Boolean(process.env.DEMO_USER_EMAIL);
  // Someone whose account was switched off mid-shift lands here without having
  // done anything, and signing in again would only tell them their password is
  // invalid. So the reason is named - and nothing more. Deactivation is usually
  // a firing: the person knows why, and "ask an administrator" reads as either
  // cruel or as false hope.
  const { reason } = await searchParams;
  const accountInactive = reason === INACTIVE_ACCOUNT_REASON;
  // An admin who has just reset their own password. Resetting ends every
  // session on the account, including the one that pressed the button, so they
  // are signed out by their own successful action and need the two halves
  // joined up: what changed, and that signing in again is the whole of it.
  const passwordChanged = reason === PASSWORD_CHANGED_REASON;
  const notice = accountInactive
    ? "This account is no longer active."
    : passwordChanged
      ? "Your password was changed, which signed this account out everywhere. Sign in with the new password."
      : null;

  return (
    <main className="grid min-h-dvh bg-zinc-950 text-white lg:grid-cols-[1fr_460px]">
      <section className="hidden min-h-dvh flex-col justify-between border-r border-white/10 p-10 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-white text-lg font-semibold text-zinc-950">
            A
          </div>
          <div>
            <div className="text-sm font-semibold">Attend</div>
            <div className="text-xs text-zinc-400">Single-store dealership communication</div>
          </div>
        </div>
        <div className="max-w-xl">
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-zinc-500">For the service advisor</p>
          <h1 className="text-5xl font-semibold tracking-tight">
            Attend reads every conversation a service advisor has and tells her what to do next.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-zinc-300">
            Every thread arrives already read, ranked by risk, with the next action on it. The rest
            of the store works the same threads, so nothing has to be handed over twice.
          </p>
        </div>
        <div />
      </section>
      <section className="flex min-h-dvh items-center justify-center bg-zinc-50 p-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-zinc-950 text-lg font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
              A
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Attend</h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Dealership communication workspace</p>
          </div>
          {notice ? (
            <p className="mb-4 rounded-lg border border-zinc-200 bg-zinc-100 p-3 text-sm leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              {notice}
            </p>
          ) : null}
          <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-xl font-semibold">Sign in</h2>
            <p className="mb-6 mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {demoEnabled
                ? "Sign in with your staff account, or take a look around with the demo."
                : "Sign in with your staff account."}
            </p>
            <Suspense>
              <LoginForm
                demoEnabled={demoEnabled}
                turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
              />
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
