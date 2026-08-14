import { compare } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyTurnstileToken } from "@/lib/turnstile";

function getDemoUserEmail() {
  return process.env.DEMO_USER_EMAIL?.toLowerCase() || null;
}

/**
 * The current instant on the database's clock, in epoch milliseconds.
 *
 * Every timestamp the deactivation cutoff compares - when a session began, when
 * an account lost access, when it was last granted a request - is read from
 * this one clock, so none of them can disagree with another. `clock_timestamp()`
 * rather than `now()` because the latter is the transaction's start time.
 *
 * Selected as epoch milliseconds rather than as a timestamp, deliberately. A
 * `SELECT clock_timestamp()` comes back through the driver as a date whose zone
 * has already been lost: on a host set to America/Chicago it read exactly five
 * hours early, which would have made every session look older than every cutoff.
 * A number has no zone to lose.
 */
async function databaseNow(): Promise<number> {
  const [{ now }] = await prisma.$queryRaw<
    [{ now: bigint }]
  >`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS now`;

  return Number(now);
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        // Taken before anything else this sign-in does, so it records when
        // authentication began rather than when it finished. Stamping it at the
        // end left a window the width of a cost-12 bcrypt compare - a couple of
        // hundred milliseconds - in which an admin could deactivate the account
        // and still have the completing sign-in claim a moment after the cutoff,
        // which the cutoff would then not refuse. Reading it first inverts that:
        // a deactivation committing after this point stamps a later cutoff and
        // the session is refused, and one committing before it is caught by the
        // account read below. The failure direction is now the safe one.
        const signedInAt = await databaseNow();

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });

        if (!user?.active) {
          return null;
        }

        const validPassword = await compare(credentials.password, user.passwordHash);

        if (!validPassword) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
          signedInAt,
        };
      },
    }),
    CredentialsProvider({
      id: "demo",
      name: "Demo",
      credentials: {
        turnstileToken: { label: "Verification token", type: "text" },
      },
      async authorize(credentials, req) {
        const demoEmail = getDemoUserEmail();

        if (!demoEmail) {
          return null;
        }

        // Same reason as the password provider: taken before the work, not
        // after it. The Turnstile verification is a network round trip, so the
        // window here would be wider still.
        const signedInAt = await databaseNow();

        const forwardedFor = req?.headers?.["x-forwarded-for"];
        const remoteIp =
          typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : undefined;

        if (!(await verifyTurnstileToken(credentials?.turnstileToken, remoteIp))) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: demoEmail },
        });

        if (!user?.active) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
          signedInAt,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.department = user.department;
        token.isDemo = Boolean(user.email && user.email.toLowerCase() === getDemoUserEmail());
        // Carried from `authorize`, where it was read from the database clock
        // before authentication began, and copied forward untouched from here.
        //
        // Not re-read now, and not taken from the token's own `iat`: NextAuth
        // re-encodes the cookie as the session refreshes, which moves `iat`
        // forward, so a deactivated browser polling /api/auth/session would walk
        // its token past the cutoff and keep the access it just lost. Not the
        // process clock either, because the value this is compared against -
        // `User.accessEndedAt` - is written by the database, and two clocks can
        // disagree.
        token.signedInAt = user.signedInAt;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.department = token.department as string | null;
        session.user.isDemo = token.isDemo === true;
        session.user.signedInAt = typeof token.signedInAt === "number" ? token.signedInAt : null;
      }

      return session;
    },
  },
};
