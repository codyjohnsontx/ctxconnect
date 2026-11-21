import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { Alert } from "@/components/ui/alert";
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
    <main className="grid min-h-dvh bg-page text-text lg:grid-cols-[1fr_460px]">
      {/* The pitch sits on the raised surface the side nav uses, so the two
          columns read as one tool rather than a poster beside a form. */}
      <section className="hidden min-h-dvh flex-col justify-between gap-8 border-r border-border bg-surface-raised p-8 lg:flex">
        <Brand />
        <div className="max-w-xl">
          <h1 className="text-700 font-semibold tracking-tight">
            Attend reads every conversation a service advisor has and tells her what to do next.
          </h1>
          <p className="mt-3 max-w-lg text-400 text-text-muted">
            Every thread arrives already read, ranked by risk, with the next action on it. The rest
            of the store works the same threads, so nothing has to be handed over twice.
          </p>
        </div>
        <div />
      </section>
      <section className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <Brand nameAs="h1" />
          </div>
          {notice ? (
            <Alert variant="info" className="mb-4">
              {notice}
            </Alert>
          ) : null}
          <div className="rounded-md border border-border bg-surface p-5">
            <h2 className="mb-4 text-500 font-semibold tracking-tight">Sign in</h2>
            <Suspense>
              <LoginForm
                demoEnabled={demoEnabled}
                turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
              />
            </Suspense>
          </div>
          <div className="mt-4 flex items-center justify-center gap-3 text-200 text-text-muted">
            <Link href="/privacy-policy" className="hover:text-text hover:underline">
              Privacy Policy
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/terms-and-conditions" className="hover:text-text hover:underline">
              Terms &amp; Conditions
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

// The mark the side nav carries, so the door and the room share one sign.
function Brand({ nameAs: Name = "span" }: { nameAs?: "span" | "h1" }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-md bg-accent text-400 font-semibold text-text-on-accent">
        A
      </span>
      <Name className="text-400 font-semibold tracking-tight">Attend</Name>
    </div>
  );
}
