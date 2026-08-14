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
        // Stamped once, at sign-in, rather than read from the token's own `iat`:
        // NextAuth re-encodes the cookie as the session is refreshed, which
        // moves `iat` forward. A deactivated browser polling /api/auth/session
        // would walk its token past the deactivation cutoff and keep the access
        // it just lost. This claim is copied forward untouched instead.
        //
        // Read from the database clock, not this process's, because the value it
        // is later compared against - `User.accessEndedAt` - is written by the
        // database. Two clocks would mean a session minted just before a
        // deactivation could carry a timestamp after the cutoff and survive it.
        // One query, once per sign-in, on a path that already queries.
        token.signedInAt = await databaseNow();
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
