import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState, EventGrid } from "@/components/event-grid";
import { EMPTY_LIST, api, safe } from "@/lib/api";
import { getAccessToken } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Saved events",
  description: "Events you've bookmarked on Qwendo.",
};

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const token = await getAccessToken();
  if (!token) redirect("/login?next=/saved");

  const saved = await safe(api.saved(token), EMPTY_LIST);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-mist-100">Saved events</h1>
        <p className="mt-1.5 text-sm text-mist-400">
          {saved.count} {saved.count === 1 ? "event" : "events"} waiting on your decision.
        </p>
      </header>

      {saved.items.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          description="Tap the bookmark on any event and it'll land here, so you can come back before tickets go."
          action={
            <Link
              href="/discover"
              className="btn btn-primary h-11 px-5"
            >
              Find events
            </Link>
          }
        />
      ) : (
        <EventGrid
          events={saved.items}
          savedIds={saved.items.map((event) => event.id)}
          showReason={false}
        />
      )}
    </div>
  );
}
