"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { api } from "@/lib/api";
import { notifications, priorityLabels } from "@/lib/discovery-profile";
import { createClient } from "@/lib/supabase/client";
import type { QwendoEvent } from "@/lib/types";
import { EventCard } from "./event-card";
import { BookmarkIcon, CheckIcon, CloseIcon, ExternalLinkIcon, RefreshIcon } from "./icons";
import { TicketLink } from "./ticket-link";
import { officialLinks, pickSections, type PicksResponse } from "./picks-model";

type State = "saved" | "going" | "dismissed";

const control =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60";
const idle = "border-ink-700 bg-ink-850 text-mist-300 hover:border-ink-500 hover:text-mist-100";
const chosen = "border-iris-400/70 bg-iris-500/15 text-iris-200";

/**
 * What you can do with a pick, in one row.
 *
 * Each card used to carry three pill buttons, a full-width "View Details" and
 * a full-width outbound button — five controls competing under every event,
 * which made the grid twice as tall as the events inside it. Details now live
 * on the card itself (the whole card links through), so what remains is the
 * judgement — save, interested, not for me — and the one place to book.
 */
function PickActions({
  event,
  state,
  busy,
  onChange,
  onTracked,
}: {
  event: QwendoEvent;
  state: State | undefined;
  busy: boolean;
  onChange: (state: State) => void;
  onTracked: () => void;
}) {
  const saved = state === "saved";
  const going = state === "going";

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={saved}
          disabled={busy}
          onClick={() => onChange("saved")}
          className={`${control} ${saved ? chosen : idle}`}
        >
          <BookmarkIcon className="h-3.5 w-3.5" filled={saved} />
          {saved ? "Saved" : "Save"}
        </button>

        <button
          type="button"
          aria-pressed={going}
          disabled={busy}
          onClick={() => onChange("going")}
          className={`${control} ${going ? chosen : idle}`}
        >
          <CheckIcon className="h-3.5 w-3.5" />
          Interested
        </button>

        {/* Icon-only and last: hiding an event is the rare choice, not a peer
            of the other two. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => onChange("dismissed")}
          title="Not for me"
          aria-label={`Hide ${event.title}`}
          className={`${control} ml-auto px-2 ${idle}`}
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {officialLinks(event).map((url) => (
        <TicketLink
          key={url}
          eventId={event.id}
          url={url}
          surface="picks"
          source={event.source}
          onTracked={onTracked}
          className="btn btn-ghost h-9 w-full px-3 text-xs"
        >
          View official page
          <ExternalLinkIcon className="h-3.5 w-3.5" />
        </TicketLink>
      ))}
    </div>
  );
}

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
  // The page is as wide as a full row of cards (three at 22rem plus their
  // gaps) rather than the 80rem shell: a heading stranded far to the left of
  // the events it labels, with Refresh stranded far to the right, read as two
  // unrelated pages.
  return <div className="mx-auto max-w-[68rem] space-y-10 px-4 py-10 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Top Picks</h1>
        <p className="mt-1 text-sm text-mist-400">Events matched to your interests.</p>
      </div>
      {/* Secondary by design: the page refreshes itself after every change. */}
      <button
        className="btn btn-ghost h-9 gap-2 px-3.5 text-xs"
        disabled={refreshing}
        onClick={refresh}
      >
        <RefreshIcon className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </header>
    {error && <p role="alert" className="text-sm text-mist-100">{error}</p>}
    {sections.map(section => <section key={section.title} className="space-y-4">
      {/* The page title already says it — repeating "Top Picks for You"
          immediately underneath would read as a glitch. */}
      {section.title !== "Top Picks for You" &&
        <h2 className="font-display text-xl font-bold sm:text-2xl">{section.title}</h2>}
      {!section.events.length && <p className="text-sm text-mist-400">{section.empty}{" "}
        {section.title === "Top Picks for You" && <Link href="/discover" className="underline">Browse events</Link>}
        {section.title === "Because You Love…" && <Link href="/settings" className="underline">Edit interests</Link>}
      </p>}
      {/* Sections hold at most three events, so a four-column grid always left
          a hole on a wide screen. Wrapping and centring keeps a short row
          balanced under its heading, whatever the count. */}
      <div className="flex flex-wrap justify-center gap-4">
        {section.events.map(event => <div
          key={event.id}
          className="grid w-full sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.667rem)] lg:max-w-[22rem]"
        >
          <EventCard
            event={event}
            quickSave={false}
            actions={<PickActions
              event={event}
              state={stateOf(event.id) ?? undefined}
              busy={pending.current.has(event.id)}
              onChange={state => change(event.id, state)}
              onTracked={refresh}
            />}
          />
        </div>)}
      </div>
    </section>)}
    <section className="surface space-y-4 rounded-card p-5 sm:p-6">
      <h2 className="font-display text-xl font-bold sm:text-2xl">Your Qwendo Radar</h2>
      {profile?.radar && <p className="text-sm text-mist-300">{profile.radar}</p>}
      {!radar.length && <p className="text-sm text-mist-400">No Radar alerts yet. Choose your must-see interests and updates in preferences.</p>}
      <ul className="space-y-2 text-sm">{radar.map((entry, i) => {
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
        {/* Reference material, not the main event: collapsed until asked for. */}
        <details open={profile.interests.length <= 3} className="text-sm">
          <summary className="cursor-pointer font-semibold">Interest priorities ({profile.interests.length})</summary>
          <ul className="mt-2 space-y-1 text-mist-400">{profile.interests.map(interest => <li key={interest.name}>
            {interest.name} · {priorityLabels[interest.priority]} · {interest.source === "explicit" ? "Added by you" : interest.confirmed ? "Confirmed by you" : "Suggested interest"}
          </li>)}</ul>
        </details>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">Notification consent</summary>
          <ul className="mt-2 space-y-1 text-mist-400">{(Object.keys(notifications) as (keyof typeof notifications)[]).map(key =>
            <li key={key}>{notifications[key]} · {profile.notifications[key] ? "On" : "Off"}</li>)}</ul>
        </details>
      </>}
      <Link className="inline-flex text-sm text-iris-200 underline" href="/settings">{profile ? "Edit preferences" : "Set up your interests"}</Link>
    </section>
  </div>;
}
