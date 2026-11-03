import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KerjaBot – AI Job Agent",
  description: "AI agent that searches MYFutureJobs for you and learns what suits you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ms">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
