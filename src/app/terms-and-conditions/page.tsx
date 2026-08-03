import Link from "next/link";

export const metadata = {
  title: "Terms and Conditions | Attend",
  description: "Terms and conditions for Attend SMS and dealership communication workflows.",
};

export default function TermsAndConditionsPage() {
  return (
    <main className="min-h-dvh bg-zinc-950 px-6 py-16 text-zinc-50">
      <div className="mx-auto max-w-3xl">
        <Link href="/login" className="text-sm text-zinc-400 hover:text-zinc-200">
          Back to login
        </Link>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">Terms and Conditions</h1>
        <p className="mt-4 text-sm text-zinc-400">Effective date: May 11, 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-7 text-zinc-300">
          <section>
            <h2 className="text-lg font-semibold text-white">Program Name</h2>
            <p className="mt-2">Attend dealership messaging program.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Program Description</h2>
            <p className="mt-2">
              Attend is used by dealership staff to send and receive customer service SMS messages, service lane
              updates, replies, reminders, and operational follow-up communications.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Opt-In</h2>
            <p className="mt-2">
              Customers opt in to receive SMS communications by providing their phone number directly to the
              dealership and agreeing to receive service-related text messages and replies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Message Frequency</h2>
            <p className="mt-2">Message frequency varies based on the customer&apos;s active conversation and service activity.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Fees</h2>
            <p className="mt-2">Message and data rates may apply.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Opt-Out and Help</h2>
            <p className="mt-2">
              Reply <strong>STOP</strong> to opt out at any time. Reply <strong>HELP</strong> for support.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Support Contact</h2>
            <p className="mt-2">Support is provided through the dealership&apos;s active customer service channels.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Carrier Disclaimer</h2>
            <p className="mt-2">Carriers are not liable for delayed or undelivered messages.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Privacy Policy</h2>
            <p className="mt-2">
              Review the Attend privacy policy at{" "}
              <Link href="/privacy-policy" className="text-white underline underline-offset-4">
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
