import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, EventGrid } from "@/components/event-grid";
import { FilterBar } from "@/components/filter-bar";
import { LoadMore } from "@/components/load-more";
import { SparklesIcon } from "@/components/icons";
import { SearchBar } from "@/components/search-bar";
import { EMPTY_LIST, api, safe, type EventQuery } from "@/lib/api";
import { getAccessToken } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Discover events",
  description: "Every event we track, ranked against your interests.",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function asArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function windowFor(when: string | undefined): Pick<EventQuery, "starts_after" | "starts_before"> {
  if (!when) return {};
  const now = new Date();
  const end = new Date(now);
  if (when === "week") end.setDate(end.getDate() + 7);
  else if (when === "month") end.setMonth(end.getMonth() + 1);
  else return {};
  return { starts_after: now.toISOString(), starts_before: end.toISOString() };
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : undefined;
  const city = typeof params.city === "string" ? params.city : "London";
  const categories = asArray(params.categories);
  const freeOnly = params.free_only === "true";
  const when = typeof params.when === "string" ? params.when : undefined;
  const sort = params.sort === "soon" ? "soon" : "match";

  const token = await getAccessToken();
  const filters: EventQuery = {
    city,
    categories,
    free_only: freeOnly || undefined,
    limit: 24,
    ...windowFor(when),
  };

  // Signed in and just browsing → personalised ranking. A specific search, or
  // an explicit "starting soonest", is an instruction: honour it rather than
  // second-guessing with the taste vector.
  const personalize = Boolean(token) && !query && sort === "match";

  const [list, saved] = await Promise.all([
    personalize
      ? safe(api.recommendations(token!, filters), EMPTY_LIST)
      : safe(api.events({ ...filters, q: query }), EMPTY_LIST),
    token ? safe(api.saved(token), EMPTY_LIST) : Promise.resolve(EMPTY_LIST),
  ]);

  const savedIds = saved.items.map((event) => event.id);
  const heading = query
    ? `Results for “${query}”`
    : personalize
      ? "Picked for you"
      : sort === "soon"
        ? `Starting soonest in ${city}`
        : `What's on in ${city}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:py-10 sm:px-6 lg:px-8">
      <div className="mb-4 space-y-2 sm:mb-8 sm:space-y-6">
        <SearchBar key={JSON.stringify([query, city])} defaultQuery={query ?? ""} defaultCity={city} size="sm" filters={Object.entries(params).filter(([key]) => ["when", "free_only", "categories", "sort"].includes(key)).flatMap(([key, values]) => asArray(values).map((value): [string, string] => [key, value]))} />
        <FilterBar />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-mist-100 sm:text-3xl">{heading}</h1>
          <p className="mt-1.5 text-sm text-mist-400">
            {list.count} {list.count === 1 ? "event" : "events"}
            {personalize && list.personalized && " · ranked by your taste profile"}
            {list.fallback === "widened-location" && " · widened beyond your city"}
          </p>
        </div>

        {personalize && !list.personalized && (
          <Link
            href="/onboarding"
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-iris-400/40 bg-iris-500/10 px-4 py-2 text-sm font-medium text-iris-200 transition-colors duration-200 hover:bg-iris-500/20"
          >
            <SparklesIcon className="h-4 w-4" />
            Add your interests to personalise this
          </Link>
        )}
      </div>

      {list.items.length === 0 ? (
        <EmptyState
          title="Nothing matches yet"
          description={
            query
              ? `We couldn't find anything for “${query}” in ${city}. Try a broader term, or clear your filters.`
              : "No events in the catalogue for these filters. Run an ingestion to pull in live listings."
          }
          action={
            <Link
              href="/discover"
              className="btn btn-ghost h-11 px-5"
            >
              Clear search
            </Link>
          }
        />
      ) : (
        <>
          <EventGrid events={list.items} savedIds={savedIds} showReason={personalize} />
          <LoadMore
            query={{ ...filters, q: query }}
            personalized={personalize}
            savedIds={savedIds}
            initialOffset={list.items.length}
            exhausted={list.items.length < 24}
          />
        </>
      )}
    </div>
  );
}
