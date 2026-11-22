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
  fashion: "Fashion & Lifestyle",
};

export const SOURCE_LABELS: Record<string, string> = {
  ticketmaster: "Ticketmaster",
  "swiss-zurich": "Swiss Data Events",
  "tickts-london": "Tickts",
  eventbrite: "Eventbrite",
  luma: "Luma",
  demo: "Sample data",
};

// Some ranked catalogue responses include the city but omit the timezone.
const CITY_ZONES: Record<string, string> = {
  london: "Europe/London", manchester: "Europe/London", edinburgh: "Europe/London",
  birmingham: "Europe/London", berlin: "Europe/Berlin", paris: "Europe/Paris",
  "new york": "America/New_York", "san francisco": "America/Los_Angeles",
  dubai: "Asia/Dubai", tashkent: "Asia/Tashkent",
};

export function eventZone(event: QwendoEvent, timestamp = event.starts_at): string {
  if (event.timezone) return event.timezone;
  const offset = timestamp?.match(/([+-]\d{2}:?\d{2})$/)?.[1];
  if (offset && !/^[+-]00:?00$/.test(offset)) return offset;
  return CITY_ZONES[event.city?.trim().toLowerCase() ?? ""] || "UTC";
}

function localDate(value: string, zone: string | null | undefined, options: Intl.DateTimeFormatOptions) {
  // Python datetime.timezone emits UTC+HH:MM. Fixed-offset zone identifiers
  // are unsupported in some browsers, so format a shifted instant in UTC.
  const offset = /^(?:UTC|GMT)?([+-])(\d{2}):?(\d{2})$/i.exec(zone ?? "");
  if (offset && Number(offset[2]) < 24 && Number(offset[3]) < 60) {
    const minutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === "-" ? -1 : 1);
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" })
      .format(Date.parse(value) + minutes * 60000);
  }
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: zone || "UTC" }).format(new Date(value));
}

export function formatDate(value: string, zone?: string | null): string {
  return localDate(value, zone, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatTime(value: string, zone?: string | null): string {
  return localDate(value, zone, { hour: "2-digit", minute: "2-digit" });
}

export function formatDayBadge(value: string, zone?: string | null): { day: string; month: string } {
  return { day: localDate(value, zone, { day: "numeric" }), month: localDate(value, zone, { month: "short" }).toUpperCase() };
}

export function calendarLabel(value: string, zone?: string | null): string {
  return localDate(value, zone, { weekday: "short", day: "numeric", month: "short" });
}

export function formatPrice(event: Pick<QwendoEvent, "price_min" | "currency" | "is_free">): string {
  if (event.is_free) return "Free";
  if (event.price_min == null || !event.currency) return "Price unlisted";
  const currency = event.currency;
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
