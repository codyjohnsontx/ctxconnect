import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | CTX Chat",
  description: "Privacy policy for CTX Chat SMS and dealership communication workflows.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-dvh bg-zinc-950 px-6 py-16 text-zinc-50">
      <div className="mx-auto max-w-3xl">
        <Link href="/login" className="text-sm text-zinc-400 hover:text-zinc-200">
          Back to login
        </Link>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-4 text-sm text-zinc-400">Effective date: May 11, 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-7 text-zinc-300">
          <section>
            <h2 className="text-lg font-semibold text-white">Overview</h2>
            <p className="mt-2">
              CTX Chat is a dealership communication workspace used to manage customer service conversations,
              follow-ups, and SMS updates. This privacy policy explains what information we collect, how we use
              it, and how SMS consent information is handled.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Information We Collect</h2>
            <p className="mt-2">We may collect customer and staff information such as:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Name, phone number, and email address</li>
              <li>Vehicle, service, and appointment-related details</li>
              <li>Conversation history, follow-up tasks, and message delivery status</li>
              <li>Operational account and login information for staff users</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">How We Use Information</h2>
            <p className="mt-2">We use collected information to:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Respond to customer questions and service requests</li>
              <li>Send service-related SMS updates, replies, reminders, and operational follow-ups</li>
              <li>Maintain dealership conversation records and internal task coordination</li>
              <li>Improve reliability, security, and support for the communication workflow</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">SMS Consent</h2>
            <p className="mt-2">
              SMS opt-in consent is collected directly by the dealership through customer interactions and message
              workflows. Message frequency varies by conversation and service activity. Message and data rates may
              apply.
            </p>
            <p className="mt-2">
              Text messaging originator opt-in data and consent will not be shared with any third parties,
              affiliates, or partners for marketing or promotional purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Data Sharing</h2>
            <p className="mt-2">
              We may share information with service providers that support the operation of CTX Chat, such as
              hosting, authentication, database, and messaging providers, strictly to operate the service. We do
              not sell customer personal information or SMS opt-in data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Opt-Out and Support</h2>
            <p className="mt-2">
              Recipients may reply <strong>STOP</strong> to opt out of SMS messages at any time. Recipients may
              reply <strong>HELP</strong> for assistance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Contact</h2>
            <p className="mt-2">
              For questions about this policy or dealership messaging practices, contact CTX Chat support through
              the dealership contact channels listed in your service communications.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
