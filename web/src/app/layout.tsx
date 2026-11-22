import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";

import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { themeInitScript } from "@/lib/theme";

import "./globals.css";

// Display: geometric-humanist, reads premium at large sizes.
const displaySans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display-sans",
  display: "swap",
});

// Body: Inter stays — unbeatable at small sizes and dense UI.
const bodySans = Inter({
  subsets: ["latin"],
  variable: "--font-body-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://qwendo.co"),
  alternates: { canonical: "/" },
  title: {
    default: "Qwendo — never miss the event you care about",
    template: "%s · Qwendo",
  },
  description:
    "Discover upcoming events from approved sources, ranked by your interests and preferences.",
  keywords: [
    "event discovery",
    "Personalised event recommendations",
    "concerts near me",
    "tech events",
    "hackathons",
    "comic con",
  ],
  openGraph: {
    title: "Qwendo — never miss the event you care about",
    description:
      "Explore upcoming events by interest and location.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // Dark is the default theme; the init script rewrites this when a member
  // has chosen light, so the browser chrome always matches the page.
  themeColor: "#0a0b0e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme attribute is written by the script below before React hydrates,
    // so the server markup never matches it — that difference is the point.
    <html
      lang="en"
      className={`${displaySans.variable} ${bodySans.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Sets data-theme before first paint: no flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-moss-400 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-950"
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
