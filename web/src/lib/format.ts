import type { QwendoEvent } from "@/lib/types";

export const CATEGORY_LABELS: Record<string, string> = {
  tech: "Tech",
  business: "Business",
  music: "Music",
  film: "Film & Fandom",
  gaming: "Gaming",
  arts: "Arts & Culture",
  comedy: "Comedy",
  sports: "Sports",
  food: "Food & Drink",
  wellness: "Health & Wellness",
  community: "Community",
  nightlife: "Nightlife",
  education: "Learning",
  family: "Family",
};

export const SOURCE_LABELS: Record<string, string> = {
  ticketmaster: "Ticketmaster",
  eventbrite: "Eventbrite",
  luma: "Luma",
  demo: "Sample data",
};

const DAY = 86_400_000;

export function formatDate(value: string, timeZone?: string | null): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timeZone ?? undefined,
  }).format(date);
}

export function formatDayBadge(value: string): { day: string; month: string } {
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat("en-GB", { day: "numeric" }).format(date),
    month: new Intl.DateTimeFormat("en-GB", { month: "short" }).format(date).toUpperCase(),
  };
}

/** "Tonight", "In 3 days", "Next Tuesday" — urgency is the whole product. */
export function countdownLabel(value: string): string {
  const diff = new Date(value).getTime() - Date.now();
  if (diff < 0) return "Started";
  const days = Math.floor(diff / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  if (days < 14) return "Next week";
  if (days < 31) return `In ${Math.round(days / 7)} weeks`;
  return new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date(value));
}

export function formatPrice(event: Pick<QwendoEvent, "price_min" | "currency" | "is_free">): string {
  if (event.is_free || event.price_min === 0) return "Free";
  if (event.price_min == null) return "See tickets";
  const currency = event.currency || "GBP";
  try {
    const formatted = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: event.price_min % 1 === 0 ? 0 : 2,
    }).format(event.price_min);
    return `From ${formatted}`;
  } catch {
    return `From ${event.price_min} ${currency}`;
  }
}

export function locationLabel(event: QwendoEvent): string {
  if (event.is_online) return "Online";
  return [event.venue_name, event.city].filter(Boolean).join(" · ") || "Location TBC";
}

export function matchPercent(event: QwendoEvent): number | null {
  const score = event.score ?? event.similarity;
  if (score == null) return null;
  // Cosine scores cluster in a narrow band; stretch them into a readable 55–99%.
  return Math.max(55, Math.min(99, Math.round(55 + score * 55)));
}

export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug;
}

/** The domain an outbound ticket link actually leads to — shown before the user clicks. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
