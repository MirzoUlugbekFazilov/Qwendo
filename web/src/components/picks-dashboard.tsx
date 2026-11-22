"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { api } from "@/lib/api";
import { notifications, priorityLabels } from "@/lib/discovery-profile";
import { categoryLabel, eventZone, formatDate, formatPrice, locationLabel } from "@/lib/format";
import { EventImage } from "./event-image";
import { createClient } from "@/lib/supabase/client";
import { EventProvenance } from "./event-provenance";
import { TicketLink } from "./ticket-link";
import { officialLinks, pickSections, type PicksResponse } from "./picks-model";

type State = "saved" | "going" | "dismissed";

export function PicksDashboard({ data, now, initialStates }: {
  data: PicksResponse;
  now: number;
  initialStates: Record<string, State>;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [overrides, setOverrides] = useState<Record<string, State | null>>({});
  const [error, setError] = useState("");
  const pending = useRef(new Set<string>());
  const stateOf = (id: string) => id in overrides ? overrides[id] : initialStates[id];
  const sections = pickSections(data.items.filter(item => stateOf(item.id) !== "dismissed"), now);
  const refresh = () => startRefresh(() => router.refresh());

  async function change(id: string, state: State) {
    if (pending.current.has(id)) return;
    pending.current.add(id);
    const before = stateOf(id) ?? null;
    const next = state === before ? null : state;
    setOverrides(previous => ({ ...previous, [id]: next }));
    setError("");
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session) {
        router.push("/login?next=/picks");
        return;
      }
      if (next) await api.save(session.access_token, id, next);
      else await api.unsave(session.access_token, id);
      refresh();
    } catch {
      setOverrides(previous => ({ ...previous, [id]: before }));
      setError("Your change couldn’t be saved. Please try again.");
    } finally {
      pending.current.delete(id);
    }
  }

  const { profile } = data;
  const radar = data.radar.filter(entry => typeof entry === "string" ||
    stateOf(String(entry.event_id ?? entry.id)) !== "dismissed").slice(0, 5);
  return <div className="mx-auto max-w-7xl space-y-12 px-4 py-10 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="font-display text-4xl font-bold">For You</h1>
      <button className="btn btn-ghost" disabled={refreshing} onClick={refresh}>
        {refreshing ? "Refreshing…" : "Refresh picks"}
      </button>
    </header>
    {error && <p role="alert">{error}</p>}
    {sections.map(section => <section key={section.title} className="space-y-4">
      <h2 className="font-display text-2xl font-bold">{section.title}</h2>
      {!section.events.length && <p className="text-sm text-mist-400">{section.empty}{" "}
        {section.title === "Top Picks for You" && <Link href="/discover" className="underline">Browse events</Link>}
        {section.title === "Because You Love…" && <Link href="/settings" className="underline">Edit interests</Link>}
      </p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {section.events.map(event => <article key={event.id} className="surface flex flex-col gap-3 overflow-hidden rounded-card p-5">
          {event.image_url && <div className="relative -mx-5 -mt-5 aspect-video bg-ink-900">
            <EventImage src={event.image_url} />
          </div>}
          <p className="text-xs font-semibold text-iris-200">
            {event.categories?.length ? event.categories.slice(0, 2).map(categoryLabel).join(" · ")
              : event.is_online ? "Online event" : "In-person event"}
          </p>
          <EventProvenance event={event} />
          <h3 className="font-display text-xl font-bold"><Link href={`/events/${event.id}`}>{event.title}</Link></h3>
          <p className="text-sm text-mist-400">{formatDate(event.starts_at, eventZone(event))} · {locationLabel(event)}</p>
          <p className="text-sm text-moss-300">{formatPrice(event)} {event.availability && `· Availability: ${event.availability}`}</p>
          {event.reason && <p className="border-l-2 border-iris-400 pl-3 text-sm">{event.reason}</p>}
          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            {(["saved", "going", "dismissed"] as const).map(action => <button key={action}
              className="btn btn-ghost px-3 text-sm aria-pressed:border-iris-400 aria-pressed:text-iris-200" aria-pressed={action === "dismissed" ? undefined : stateOf(event.id) === action}
              disabled={pending.current.has(event.id)} onClick={() => change(event.id, action)}>
              {action === "saved" ? (stateOf(event.id) === action ? "Saved" : "Save") : action === "going" ? "Interested" : "Not for me"}
            </button>)}
          </div>
          <Link className="btn btn-ghost" href={`/events/${event.id}`}>View Details</Link>
          {officialLinks(event).map(url => <TicketLink key={url} eventId={event.id} url={url}
            surface="picks" source={event.source} onTracked={refresh} />)}
        </article>)}
      </div>
    </section>)}
    <section className="surface space-y-4 rounded-card p-6">
      <h2 className="font-display text-2xl font-bold">Your Qwendo Radar</h2>
      {profile?.radar && <p>{profile.radar}</p>}
      {!radar.length && <p className="text-sm text-mist-400">No Radar alerts yet. Choose your must-see interests and updates in preferences.</p>}
      <ul className="space-y-2">{radar.map((entry, i) => {
        if (typeof entry === "string") return <li key={i}>{entry}</li>;
        const id = entry.event_id ?? entry.id;
        const event = data.items.find(item => item.id === id);
        const label = [entry.title, entry.reason, event?.title, entry.name, entry.interest, entry.label].find(v => typeof v === "string");
        const kind = typeof entry.kind === "string" ? entry.kind.split(":")[0].replaceAll("_", " ") : "";
        return <li key={i}>{kind && <span className="mr-2 text-xs uppercase text-iris-200">{kind}</span>}{typeof id === "string"
          ? <Link className="underline" href={`/events/${encodeURIComponent(id)}`}>{label ?? "View Radar match"}</Link>
          : label}</li>;
      })}</ul>
      {profile && <>
        <details open={profile.interests.length <= 3}><summary className="cursor-pointer font-semibold">Interest priorities ({profile.interests.length})</summary>
        <ul>{profile.interests.map(interest => <li key={interest.name}>
          {interest.name} · {priorityLabels[interest.priority]} · {interest.source === "explicit" ? "Added by you" : interest.confirmed ? "Confirmed by you" : "Suggested interest"}
        </li>)}</ul></details>
        <h3 className="font-semibold">Notification consent</h3>
        <ul>{(Object.keys(notifications) as (keyof typeof notifications)[]).map(key =>
          <li key={key}>{notifications[key]} · {profile.notifications[key] ? "On" : "Off"}</li>)}</ul>
      </>}
      <Link className="inline-flex text-iris-200 underline" href="/settings">{profile ? "Edit preferences" : "Set up your interests"}</Link>
    </section>
  </div>;
}
