"use client";

import Link from "next/link";
import { useState } from "react";

import { EventCard } from "@/components/event-card";
import { ArrowRightIcon, SparklesIcon } from "@/components/icons";
import { InterestChips } from "@/components/interest-chips";
import { api } from "@/lib/api";
import type { Interest, QwendoEvent } from "@/lib/types";

const STARTER_SELECTION = ["comics-superheroes", "tech-hackathons", "biz-networking"];

/**
 * The landing-page hook: pick interests, see real matched events immediately —
 * no account, no email. Signing up is then about *keeping* the feed, not
 * finding out whether it works.
 */
export function TastePreview({ interests, city = "London" }: { interests: Interest[]; city?: string }) {
  const [selected, setSelected] = useState<string[]>(STARTER_SELECTION);
  const [freeText, setFreeText] = useState("");
  const [results, setResults] = useState<QwendoEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(slug: string) {
    setSelected((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  }

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const response = await api.preview({
        interests: selected,
        interest_text: freeText.trim() || undefined,
        city,
        limit: 6,
      });
      setResults(response.items);
    } catch {
      setError("Couldn't reach the recommendation service. Is the API running on port 8000?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="surface space-y-5 rounded-card p-6">
        <div className="space-y-1.5">
          <h3 className="font-display text-xl font-semibold text-mist-100">Tell us what you love</h3>
          <p className="text-sm text-mist-400">
            Pick a few. We&apos;ll match them against upcoming events in {city}.
          </p>
        </div>

        <div className="max-h-80 overflow-y-auto pr-2">
          <InterestChips interests={interests} selected={selected} onToggle={toggle} />
        </div>

        <div className="space-y-2">
          <label htmlFor="free-text" className="block text-sm font-medium text-mist-300">
            Anything specific? <span className="text-mist-500">(optional)</span>
          </label>
          <input
            id="free-text"
            type="text"
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            placeholder="e.g. Spider-Man, Arctic Monkeys, Formula 1"
            className="h-12 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-mist-100 placeholder:text-mist-500 transition-colors duration-200 focus:border-moss-400 focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={run}
          disabled={loading || selected.length === 0}
          className="btn btn-accent h-12 w-full"
        >
          <SparklesIcon className="h-4 w-4" />
          {loading ? "Matching events…" : "Show my matches"}
        </button>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {results === null && !loading && (
          <div className="surface relative grid h-full min-h-72 place-items-center overflow-hidden rounded-card bg-gradient-to-br from-ink-850 via-ink-875 to-ink-900 p-8 text-center">
            {/* A large empty panel reads as a dead slab; a slow wash gives it life
                while it waits for the user's first pick. */}
            <span
              className="orb pointer-events-none -right-[20%] -top-[30%] h-[22rem] w-[28rem] bg-iris-500/14"
              style={{ animation: "drift-b 40s ease-in-out infinite" }}
              aria-hidden="true"
            />
            <div className="relative space-y-2">
              <SparklesIcon className="mx-auto h-8 w-8 text-iris-300" />
              <p className="font-display text-lg font-semibold text-mist-100">
                Your matches appear here
              </p>
              <p className="mx-auto max-w-sm text-sm text-mist-400">
                Ranked using your selected interests.
              </p>
            </div>
          </div>
        )}

        {loading && (
          <div className="grid gap-5 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="surface overflow-hidden rounded-card" aria-hidden="true">
                <div className="aspect-[16/9] skeleton" />
                <div className="space-y-3 p-5">
                  <div className="h-3 w-20 skeleton rounded" />
                  <div className="h-4 w-full skeleton rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {results !== null && !loading && (
          <>
            {results.length === 0 ? (
              <div className="surface grid min-h-72 place-items-center rounded-card p-8 text-center text-sm text-mist-400">
                No matching events yet. Try another interest or city.
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                {results.slice(0, 4).map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
            )}

            <Link
              href="/login?mode=signup"
              className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-moss-400 transition-colors duration-200 hover:text-moss-300"
            >
              Create an account to save your interests
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
