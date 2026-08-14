import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      department: string | null;
      isDemo: boolean;
      // Milliseconds, stamped when this session was minted. Null for sessions
      // that predate the claim; the resolver treats those as unverifiable.
      signedInAt: number | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    department: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    department?: string | null;
    isDemo?: boolean;
    signedInAt?: number;
  }
}
