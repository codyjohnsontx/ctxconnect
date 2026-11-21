import Link from "next/link";

export const metadata = {
  title: "Terms and Conditions | Attend",
  description: "Terms and conditions for Attend SMS and dealership communication workflows.",
};

export default function TermsAndConditionsPage() {
  return (
    <main className="min-h-dvh bg-page px-4 py-8 text-text lg:py-12">
      <div className="mx-auto max-w-3xl">
        <Link href="/login" className="text-200 font-medium text-accent underline-offset-2 hover:underline">
          Back to login
        </Link>
        <h1 className="mt-4 text-700 font-semibold tracking-tight">Terms and Conditions</h1>
        <p className="mt-1 text-200 text-text-muted">Effective date: May 11, 2026</p>

        <div className="mt-6 space-y-6 rounded-md border border-border bg-surface p-5 text-400 lg:p-6">
          <section>
            <h2 className="text-500 font-semibold tracking-tight">Program Name</h2>
            <p className="mt-2">Attend dealership messaging program.</p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Program Description</h2>
            <p className="mt-2">
              Attend is used by dealership staff to send and receive customer service SMS messages, service lane
              updates, replies, reminders, and operational follow-up communications.
            </p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Opt-In</h2>
            <p className="mt-2">
              Customers opt in to receive SMS communications by providing their phone number directly to the
              dealership and agreeing to receive service-related text messages and replies.
            </p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Message Frequency</h2>
            <p className="mt-2">Message frequency varies based on the customer&apos;s active conversation and service activity.</p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Fees</h2>
            <p className="mt-2">Message and data rates may apply.</p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Opt-Out and Help</h2>
            <p className="mt-2">
              Reply <strong>STOP</strong> to opt out at any time. Reply <strong>HELP</strong> for support.
            </p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Support Contact</h2>
            <p className="mt-2">Support is provided through the dealership&apos;s active customer service channels.</p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Carrier Disclaimer</h2>
            <p className="mt-2">Carriers are not liable for delayed or undelivered messages.</p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Privacy Policy</h2>
            <p className="mt-2">
              Review the Attend privacy policy at{" "}
              <Link href="/privacy-policy" className="font-medium text-accent underline underline-offset-2">
                /privacy-policy
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
