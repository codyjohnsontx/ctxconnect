import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Attend",
  description: "Internal dealership communication command center",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Attend",
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
      className={`${inter.variable} h-full antialiased`}
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
