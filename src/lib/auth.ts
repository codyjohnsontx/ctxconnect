import { compare } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyTurnstileToken } from "@/lib/turnstile";

function getDemoUserEmail() {
  return process.env.DEMO_USER_EMAIL?.toLowerCase() || null;
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
        token.signedInAt = Date.now();
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
