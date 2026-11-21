"use client";

import { useState } from "react";

import { EventCard } from "@/components/event-card";
import { ArrowRightIcon } from "@/components/icons";
import { api, type EventQuery } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { QwendoEvent } from "@/lib/types";

const PAGE_SIZE = 24;

/**
 * Appends further pages below the server-rendered first page.
 *
 * The feed previously stopped dead at 24 events with no way forward, which
 * quietly hid most of the catalogue. Personalised feeds re-use the visitor's
 * Supabase session so later pages stay ranked the same way as the first.
 */
export function LoadMore({
  query,
  personalized,
  savedIds = [],
  initialOffset = PAGE_SIZE,
  exhausted = false,
}: {
  query: EventQuery;
  personalized: boolean;
  savedIds?: string[];
  initialOffset?: number;
  exhausted?: boolean;
}) {
  const [items, setItems] = useState<QwendoEvent[]>([]);
  const [offset, setOffset] = useState(initialOffset);
  const [done, setDone] = useState(exhausted);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const page = { ...query, limit: PAGE_SIZE, offset };

      let next;
      if (personalized) {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        next = session
          ? await api.recommendations(session.access_token, page)
          : await api.events(page);
      } else {
        next = await api.events(page);
      }

      setItems((current) => [...current, ...next.items]);
      setOffset((current) => current + next.items.length);
      if (next.items.length < PAGE_SIZE) setDone(true);
    } catch {
      setError("Couldn't load more events. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {items.length > 0 && (
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              saved={savedIds.includes(event.id)}
              showReason={personalized}
            />
          ))}
        </div>
      )}

      <div className="mt-10 flex flex-col items-center gap-3">
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        {done ? (
          <p className="text-sm text-mist-500">
            That&apos;s everything we&apos;re tracking for these filters.
          </p>
        ) : (
          <button type="button" onClick={loadMore} disabled={loading} className="btn btn-ghost h-12 px-7">
            {loading ? "Loading…" : "Load more events"}
            {!loading && <ArrowRightIcon className="h-4 w-4 rotate-90" />}
          </button>
        )}
      </div>
    </>
  );
}
