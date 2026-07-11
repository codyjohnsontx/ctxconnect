import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      department: string | null;
      isDemo: boolean;
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
  }
}
