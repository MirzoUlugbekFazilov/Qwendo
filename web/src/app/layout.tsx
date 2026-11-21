import type { Metadata, Viewport } from "next";
import { DM_Sans, Inter } from "next/font/google";

import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";

import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://qwendo.com"),
  title: {
    default: "Qwendo — never miss the event you care about",
    template: "%s · Qwendo",
  },
  description:
    "Qwendo watches Ticketmaster, Eventbrite, Luma and more, then uses AI to surface the events that match your interests — while tickets are still on sale.",
  keywords: [
    "event discovery",
    "AI event recommendations",
    "concerts near me",
    "tech events",
    "hackathons",
    "comic con",
  ],
  openGraph: {
    title: "Qwendo — never miss the event you care about",
    description:
      "One feed for every ticket marketplace, ranked against what you actually like.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${inter.variable}`}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-amber-400 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-950"
        >
          Skip to content
        </a>
        <Navbar />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
