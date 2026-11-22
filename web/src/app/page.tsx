import Link from "next/link";

import { EventGrid } from "@/components/event-grid";
import { AuroraBackdrop } from "@/components/aurora-backdrop";
import { HeroCollage } from "@/components/hero-collage";
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
import { HERO_CARD_COUNT, pickVariedEvents } from "@/lib/featured";
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
  const [interests, trending, heroEvents, stats] = await Promise.all([
    safe(api.interests(), []),
    // Over-fetch: the hero claims six of these, and showing the same event
    // twice on one page makes the catalogue look thinner than it is.
    safe(api.trending("London", 30), EMPTY_LIST),
    // Curated separately: only artwork nobody has vetoed reaches the hero.
    safe(api.heroEvents("London", 24), EMPTY_LIST),
    safe(api.stats(), { events: 0, sources: 0, cities: 0, interests: 0, last_updated: null }),
  ]);

  // Resolve the hero's actual six first, so only those are withheld from the
  // grid — excluding every candidate would starve it.
  const heroCards = pickVariedEvents(heroEvents.items, HERO_CARD_COUNT);
  const heroIds = new Set(heroCards.map((event) => event.id));
  const trendingItems = pickVariedEvents(
    trending.items.filter((event) => !heroIds.has(event.id)),
    6,
  );

  // Counted live rather than hard-coded, so the landing page can't drift into
  // claiming numbers that stopped being true.
  const facts = [
    { value: stats.events ? stats.events.toLocaleString("en-GB") : "—", label: "upcoming events tracked" },
    { value: stats.sources || "—", label: "marketplaces watched" },
    { value: stats.interests || "—", label: "interests to match on" },
    { value: "0", label: "booking fees — we don't sell tickets" },
  ];

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="aurora grain relative overflow-hidden border-b border-ink-850">
        <AuroraBackdrop />
        <HeroCollage events={heroCards} />

        <div className="relative mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 sm:py-28 lg:px-8">
          <Link
            href="/discover"
            className="animate-fade group inline-flex items-center gap-2.5 rounded-pill border border-ink-700 bg-ink-900/80 py-1.5 pl-1.5 pr-3.5 text-xs font-medium text-mist-300 backdrop-blur transition-colors duration-200 hover:border-ink-500 hover:text-mist-100"
          >
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-iris-500/20 px-2.5 py-1 text-[0.6875rem] font-semibold text-iris-200">
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className="absolute inline-flex h-full w-full rounded-full bg-moss-400"
                  style={{ animation: "ping-soft 2.4s cubic-bezier(0,0,0.2,1) infinite" }}
                />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-moss-400" />
              </span>
              Live
            </span>
            {stats.events > 0
              ? `${stats.events.toLocaleString("en-GB")} events tracked right now`
              : "AI event discovery across every marketplace"}
            <ArrowRightIcon className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>

          <h1 className="mt-7 font-display text-[2.75rem] font-extrabold leading-[1.02] tracking-[-0.035em] text-mist-100 sm:text-[4rem] lg:text-[4.75rem]">
            <span className="block">Never miss the event</span>
            <span className="block">you actually care about</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-mist-400">
            Qwendo finds events for you, then ranks based on your interests while tickets
            are still available.
          </p>

          <div className="mx-auto mt-10 max-w-3xl">
            <SearchBar />
            <a href="#matching-demo" className="mt-3 inline-block py-2 text-sm font-semibold text-iris-300 underline">Try my recommendations</a>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm text-mist-500">
            <span>Popular:</span>
            {["Spider-Man", "Hackathons", "Live music", "Networking", "Comedy"].map((term) => (
              <Link
                key={term}
                href={`/discover?q=${encodeURIComponent(term)}&city=London`}
                className="cursor-pointer rounded-pill border border-ink-800 bg-ink-900/60 px-3 py-1 text-mist-300 backdrop-blur transition-colors duration-200 hover:border-iris-400/60 hover:bg-iris-500/10 hover:text-iris-200"
              >
                {term}
              </Link>
            ))}
          </div>
        </div>

        {/* Facts strip grounds the promise in specifics. `relative` keeps it
            above the collage, which is absolutely positioned across the hero. */}
        <div className="relative border-t border-ink-800 bg-ink-950/80 backdrop-blur-sm">
          <dl className="mx-auto grid max-w-5xl grid-cols-2 gap-px bg-ink-800/80 sm:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.label} className="bg-ink-950/90 px-4 py-6 text-center backdrop-blur-sm">
                <dt className="sr-only">{fact.label}</dt>
                <dd>
                  <span className="font-display text-2xl font-extrabold text-mist-100">
                    {fact.value}
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-mist-400">
                    {fact.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Problem ──────────────────────────────────────────── */}
      <section className="reveal mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-extrabold text-mist-100 sm:text-4xl">
            The event was perfect. You just found out too late.
          </h2>
          <p className="mt-4 text-mist-400">
            Discovery is broken because it&apos;s split across a dozen platforms, none of which
            know you.
          </p>
        </div>

        <div className="stagger mt-10 grid gap-5 md:grid-cols-3">
          {PROBLEMS.map(({ icon: Icon, title, body }, index) => (
            <div
              key={title}
              style={{ "--i": index } as React.CSSProperties}
              className="surface surface-hover gradient-ring rounded-card p-6"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-iris-500/25 to-moss-500/20 text-iris-200 ring-1 ring-iris-500/20">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-lg font-bold text-mist-100">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Live demo ────────────────────────────────────────── */}
      <section
        id="matching-demo"
        className="reveal relative scroll-mt-16 overflow-hidden"
      >
        <AuroraBackdrop variant="section" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mb-10 max-w-2xl">
            <h2 className="font-display text-3xl font-extrabold text-mist-100 sm:text-4xl">
              Try it right now. <span className="text-iris-300">No account.</span>
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
      <section className="reveal mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <h2 className="font-display text-3xl font-extrabold text-mist-100 sm:text-4xl">
          How it works
        </h2>
        <div className="stagger mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <div
              key={step.number}
              style={{ "--i": index } as React.CSSProperties}
              className="surface relative overflow-hidden rounded-card p-6"
            >
              <span
                className="absolute right-4 top-2 font-display text-6xl font-extrabold text-ink-800/70"
                aria-hidden="true"
              >
                {step.number}
              </span>
              <span className="relative font-display text-xs font-bold tracking-[0.22em] text-moss-300">
                STEP {step.number}
              </span>
              <h3 className="relative mt-3 font-display text-lg font-bold text-mist-100">
                {step.title}
              </h3>
              <p className="relative mt-2 text-sm leading-relaxed text-mist-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Categories ───────────────────────────────────────── */}
      <section className="reveal mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <h2 className="font-display text-2xl font-extrabold text-mist-100">
          Browse by what you like
        </h2>
        <div className="mt-6 flex flex-wrap gap-2.5">
          {Object.entries(CATEGORY_LABELS).map(([slug, label]) => (
            <Link
              key={slug}
              href={`/discover?categories=${slug}&city=London`}
              className="surface cursor-pointer rounded-pill px-4 py-2 text-sm text-mist-300 transition-all duration-200 hover:border-iris-400/50 hover:bg-iris-500/10 hover:text-iris-200"
            >
              {label}
            </Link>
          ))}
        </div>
      </section>

      {/* ── Trending ─────────────────────────────────────────── */}
      {trendingItems.length > 0 && (
        <section className="reveal mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-extrabold text-mist-100">
                Trending in London
              </h2>
              <p className="mt-1.5 text-sm text-mist-400">
                What everyone else is clicking through to right now.
              </p>
            </div>
            <Link
              href="/discover?city=London"
              className="group inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-moss-300 transition-colors duration-200 hover:text-moss-200"
            >
              See everything
              <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>
          <EventGrid events={trendingItems} showReason={false} />
        </section>
      )}

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="reveal mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="grain surface relative overflow-hidden rounded-card px-6 py-16 text-center sm:px-12">
          <AuroraBackdrop variant="section" />
          <h2 className="relative font-display text-3xl font-extrabold text-mist-100 sm:text-4xl">
            Your next favourite night is{" "}
            <span className="text-gradient">already on sale</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-mist-400">
            Set your interests once. We&apos;ll keep watching every marketplace so you don&apos;t
            have to.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login?mode=signup" className="btn btn-primary h-12 px-7">
              Create your feed — free
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link href="/discover" className="btn btn-ghost h-12 px-7">
              Browse without an account
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
