import type { QwendoEvent } from "@/lib/types";
import type { DiscoveryProfile } from "@/lib/discovery-profile";

export type PickEvent = QwendoEvent & {
  matched_interest?: string | null;
  exploratory: boolean;
  availability?: string | null;
};

export type PicksResponse = {
  items: PickEvent[];
  profile: DiscoveryProfile | null;
  radar: (string | Record<string, unknown>)[];
};

type PickSection = { title: string; events: PickEvent[]; empty: string; };

export function pickSections(items: PickEvent[], now: number): PickSection[] {
  const groups = new Map<string, PickEvent[]>();
  for (const event of items) {
    if (!event.matched_interest || event.exploratory) continue;
    const group = groups.get(event.matched_interest) ?? [];
    group.push(event);
    groups.set(event.matched_interest, group);
  }
  const discovered = (event: PickEvent) => Date.parse(event.first_seen_at ?? "");
  const recent = items.filter(event => {
    const age = now - discovered(event);
    return age >= 0 && age <= 7 * 86400000;
  }).sort((a, b) => discovered(b) - discovered(a));
  const publishedAt = (event: PickEvent) => Date.parse(event.source_published_at ?? "");
  const announced = items.filter(event => {
    const age = now - publishedAt(event);
    return event.verification_status === "verified" && age >= 0 && age <= 7 * 86400000;
  }).sort((a, b) => publishedAt(b) - publishedAt(a));
  return [
    { title: "Top Picks for You", events: items.filter(event => !event.exploratory).slice(0, 3),
      empty: "No upcoming events match your interests and preferences yet." },
    ...(announced.length ? [{ title: "Just Announced", events: announced.slice(0, 3), empty: "" }] : []),
    { title: "Recently Discovered", events: recent.slice(0, 3),
      empty: "No matching listings were discovered in the past seven days." },
    ...(groups.size ? Array.from(groups).slice(0, 2).map(([interest, events]) => ({
      title: `Because You Love ${interest}`, events: events.slice(0, 3), empty: "",
    })) : [{ title: "Because You Love…", events: [], empty: "Add a favourite artist, team or topic to find more specific matches." }]),
    { title: "Explore Something New", events: items.filter(event => event.exploratory).slice(0, 3),
      empty: "No new suggestions beyond your usual interests today." },
  ];
}

function verifiedLink(event: QwendoEvent, value?: string | null): string | null {
  if (event.verification_status !== "verified" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function officialLinks(event: QwendoEvent): string[] {
  const url = verifiedLink(event, event.official_url);
  return url ? [url] : [];
}

export function sourceListing(event: QwendoEvent): string | null {
  const url = verifiedLink(event, event.url);
  return url === verifiedLink(event, event.official_url) ? null : url;
}
