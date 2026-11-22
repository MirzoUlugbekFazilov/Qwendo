import Link from "next/link";

import { Logo } from "@/components/logo";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-ink-850 bg-ink-950">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.5fr_1fr] lg:px-8">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-sm text-sm leading-relaxed text-mist-400">
            Discover upcoming events by topic and location.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-mist-300">
            Product
          </h2>
          <ul className="space-y-2 text-sm text-mist-400">
            <li>
              <Link href="/discover" className="transition-colors duration-200 hover:text-moss-300">
                Discover events
              </Link>
            </li>
            <li>
              <Link href="/onboarding" className="transition-colors duration-200 hover:text-moss-300">
                Set your interests
              </Link>
            </li>
            <li><Link href="/submit">Submit an event</Link></li>
            <li>
              <Link href="/saved" className="transition-colors duration-200 hover:text-moss-300">
                Saved events
              </Link>
            </li>
          </ul>
        </div>

      </div>

      <div className="border-t border-ink-850">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-mist-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} Qwendo. Tickets are sold by the original organisers.</p>

        </div>
      </div>
    </footer>
  );
}
