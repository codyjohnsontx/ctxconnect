import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CTX Chat",
  description: "Internal dealership communication command center",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "CTX Chat",
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const theme=localStorage.getItem("ctx-theme");const prefersDark=window.matchMedia("(prefers-color-scheme: dark)").matches;if(theme==="dark"||(!theme&&prefersDark)){document.documentElement.classList.add("dark")}else{document.documentElement.classList.remove("dark")}}catch{}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
