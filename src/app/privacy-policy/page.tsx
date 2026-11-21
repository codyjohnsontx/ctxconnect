import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Attend",
  description: "Privacy policy for Attend SMS and dealership communication workflows.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-dvh bg-page px-4 py-8 text-text lg:py-12">
      <div className="mx-auto max-w-3xl">
        <Link href="/login" className="text-200 font-medium text-accent underline-offset-2 hover:underline">
          Back to login
        </Link>
        <h1 className="mt-4 text-700 font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-1 text-200 text-text-muted">Effective date: May 11, 2026</p>

        <div className="mt-6 space-y-6 rounded-md border border-border bg-surface p-5 text-400 lg:p-6">
          <section>
            <h2 className="text-500 font-semibold tracking-tight">Overview</h2>
            <p className="mt-2">
              Attend is a dealership communication workspace used to manage customer service conversations,
              follow-ups, and SMS updates. This privacy policy explains what information we collect, how we use
              it, and how SMS consent information is handled.
            </p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Information We Collect</h2>
            <p className="mt-2">We may collect customer and staff information such as:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Name, phone number, and email address</li>
              <li>Vehicle, service, and appointment-related details</li>
              <li>Conversation history, follow-up tasks, and message delivery status</li>
              <li>Operational account and login information for staff users</li>
            </ul>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">How We Use Information</h2>
            <p className="mt-2">We use collected information to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Respond to customer questions and service requests</li>
              <li>Send service-related SMS updates, replies, reminders, and operational follow-ups</li>
              <li>Maintain dealership conversation records and internal task coordination</li>
              <li>Improve reliability, security, and support for the communication workflow</li>
            </ul>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">SMS Consent</h2>
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
            <h2 className="text-500 font-semibold tracking-tight">Data Sharing</h2>
            <p className="mt-2">
              We may share information with service providers that support the operation of Attend, such as
              hosting, authentication, database, and messaging providers, strictly to operate the service. We do
              not sell customer personal information or SMS opt-in data.
            </p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Opt-Out and Support</h2>
            <p className="mt-2">
              Recipients may reply <strong>STOP</strong> to opt out of SMS messages at any time. Recipients may
              reply <strong>HELP</strong> for assistance.
            </p>
          </section>

          <section>
            <h2 className="text-500 font-semibold tracking-tight">Contact</h2>
            <p className="mt-2">
              For questions about this policy or dealership messaging practices, contact Attend support through
              the dealership contact channels listed in your service communications.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
