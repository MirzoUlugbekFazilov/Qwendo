import Link from "next/link";

import { EventGrid } from "@/components/event-grid";
import {
  ArrowRightIcon,
  BellIcon,
  LayersIcon,
  SparklesIcon,
  TicketIcon,
} from "@/components/icons";
import { SearchBar } from "@/components/search-bar";
import { TastePreview } from "@/components/taste-preview";
import { EMPTY_LIST, api, safe } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/format";

export const revalidate = 300;

const PROBLEMS = [
  {
    icon: TicketIcon,
    title: "Sold out before you looked",
    body: "The gig you'd have loved went on sale on a Tuesday morning you knew nothing about.",
  },
  {
    icon: BellIcon,
    title: "Found out a week too late",
    body: "A Spider-Man fan meet, a hackathon, the exact networking night you needed — all last week.",
  },
  {
    icon: LayersIcon,
    title: "Six tabs, no answers",
    body: "Ticketmaster, Eventbrite, Luma, Instagram, a WhatsApp group. Nobody has time for that.",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Tell us what you're into",
    body: "Pick interests and your city. Spider-Man and hackathons is a perfectly normal combination.",
  },
  {
    number: "02",
    title: "We watch every marketplace",
    body: "Scrapers pull new listings from Ticketmaster, Eventbrite and Luma the moment they're posted.",
  },
  {
    number: "03",
    title: "You get the ones that fit",
    body: "A vector search ranks every event against your taste, your city and how soon it sells out.",
  },
];

export default async function HomePage() {
  const [interests, trending] = await Promise.all([
    safe(api.interests(), []),
    safe(api.trending("London", 6), EMPTY_LIST),
  ]);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="aurora relative overflow-hidden border-b border-ink-850">
        <div className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 sm:py-28 lg:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/70 px-4 py-1.5 text-xs font-medium text-mist-300 backdrop-blur">
            <SparklesIcon className="h-3.5 w-3.5 text-amber-400" />
            AI event discovery across every marketplace
          </span>

          <h1 className="mt-7 font-display text-4xl font-bold leading-[1.08] sm:text-6xl">
            <span className="text-mist-100">Never miss the event</span>
            <br />
            <span className="text-gradient">you actually care about</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-mist-400">
            Qwendo reads Ticketmaster, Eventbrite and Luma for you, then ranks what&apos;s on
            against your interests — so you hear about it while tickets are still on sale.
          </p>

          <div className="mx-auto mt-10 max-w-3xl">
            <SearchBar />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm text-mist-500">
            <span>Popular:</span>
            {["Spider-Man", "Hackathons", "Live music", "Networking", "Comedy"].map((term) => (
              <Link
                key={term}
                href={`/discover?q=${encodeURIComponent(term)}&city=London`}
                className="cursor-pointer rounded-full border border-ink-800 px-3 py-1 text-mist-300 transition-colors duration-200 hover:border-amber-400/60 hover:text-amber-300"
              >
                {term}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Problem ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-bold text-mist-100 sm:text-4xl">
            The event was perfect. You just found out too late.
          </h2>
          <p className="mt-4 text-mist-400">
            Discovery is broken because it&apos;s split across a dozen platforms, none of which
            know you.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {PROBLEMS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="surface surface-hover rounded-card p-6">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-ink-800 text-amber-400">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold text-mist-100">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Live demo ────────────────────────────────────────── */}
      <section className="border-y border-ink-850 bg-ink-900/40">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mb-10 max-w-2xl">
            <h2 className="font-display text-3xl font-bold text-mist-100 sm:text-4xl">
              Try it right now. No account.
            </h2>
            <p className="mt-4 text-mist-400">
              Pick a few interests and watch the feed rebuild itself against what&apos;s actually
              on sale in London.
            </p>
          </div>
          <TastePreview interests={interests} />
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <h2 className="font-display text-3xl font-bold text-mist-100 sm:text-4xl">How it works</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.number} className="surface rounded-card p-6">
              <span className="font-display text-sm font-bold tracking-[0.2em] text-amber-400">
                {step.number}
              </span>
              <h3 className="mt-3 font-display text-lg font-semibold text-mist-100">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Categories ───────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <h2 className="font-display text-2xl font-bold text-mist-100">Browse by what you like</h2>
        <div className="mt-6 flex flex-wrap gap-2.5">
          {Object.entries(CATEGORY_LABELS).map(([slug, label]) => (
            <Link
              key={slug}
              href={`/discover?categories=${slug}&city=London`}
              className="surface surface-hover cursor-pointer rounded-full px-4 py-2 text-sm text-mist-300"
            >
              {label}
            </Link>
          ))}
        </div>
      </section>

      {/* ── Trending ─────────────────────────────────────────── */}
      {trending.items.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-bold text-mist-100">
                Trending in London
              </h2>
              <p className="mt-1.5 text-sm text-mist-400">
                What everyone else is clicking through to right now.
              </p>
            </div>
            <Link
              href="/discover?city=London"
              className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-amber-400 transition-colors duration-200 hover:text-amber-300"
            >
              See everything
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
          <EventGrid events={trending.items} showReason={false} />
        </section>
      )}

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="glow-amber surface relative overflow-hidden rounded-card px-6 py-16 text-center sm:px-12">
          <div className="aurora absolute inset-0 -z-10" aria-hidden="true" />
          <h2 className="font-display text-3xl font-bold text-mist-100 sm:text-4xl">
            Your next favourite night is already on sale
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-mist-400">
            Set your interests once. We&apos;ll keep watching every marketplace so you don&apos;t
            have to.
          </p>
          <Link
            href="/login?mode=signup"
            className="mt-8 inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-amber-400 px-7 text-sm font-semibold text-ink-950 transition-colors duration-200 hover:bg-amber-300"
          >
            Create your feed — free
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
