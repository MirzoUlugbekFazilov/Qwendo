import Link from "next/link";

import { categoryLabel, formatDayBadge } from "@/lib/format";
import type { QwendoEvent } from "@/lib/types";

/**
 * Posters from the live catalogue, arranged either side of the hero.
 *
 * Rules this layout follows:
 *   1. Nothing is clipped by the viewport edge — a half-cut poster reads as a
 *      bug, not a design.
 *   2. The centre column stays clear, so posters never fight the headline.
 *   3. Nothing is drawn on top of the artwork. Marketplace posters carry their
 *      own title in the image; a badge over it hides the very thing that makes
 *      the poster meaningful.
 *   4. The caption names the actual event, not just its category. "Female
 *      Founder Pitch Night" says far more than "TECH" — the category alone is
 *      accurate but tells a first-time visitor almost nothing.
 */

type Slot = { position: string; size: string; tilt: string; dim: string };

// Outer margins only: every offset plus its width stays inside the frame, and
// nothing enters the middle where the text sits.
const LEFT_SLOTS: Slot[] = [
  { position: "left-[3%] top-[7%]", size: "w-[8.5rem]", tilt: "-rotate-[7deg]", dim: "opacity-75" },
  { position: "left-[9%] top-[38%]", size: "w-[7.5rem]", tilt: "rotate-[6deg]", dim: "opacity-60" },
  { position: "left-[2%] top-[58%]", size: "w-[7rem]", tilt: "-rotate-[4deg]", dim: "opacity-50" },
  {
    position: "left-[14%] top-[18%] hidden 2xl:block",
    size: "w-[6rem]",
    tilt: "rotate-[9deg]",
    dim: "opacity-40",
  },
];

const RIGHT_SLOTS: Slot[] = [
  { position: "right-[3%] top-[9%]", size: "w-[8.5rem]", tilt: "rotate-[7deg]", dim: "opacity-75" },
  { position: "right-[9%] top-[40%]", size: "w-[7.5rem]", tilt: "-rotate-[6deg]", dim: "opacity-60" },
  { position: "right-[2%] top-[60%]", size: "w-[7rem]", tilt: "rotate-[4deg]", dim: "opacity-50" },
  {
    position: "right-[14%] top-[20%] hidden 2xl:block",
    size: "w-[6rem]",
    tilt: "-rotate-[9deg]",
    dim: "opacity-40",
  },
];

const SLOTS = [...LEFT_SLOTS, ...RIGHT_SLOTS];

/**
 * One event per category first, so the hero shows the breadth of the
 * catalogue instead of four tech meetups in a row.
 */
function pickVaried(events: QwendoEvent[], count: number): QwendoEvent[] {
  const withArtwork = events.filter((event) => event.image_url);
  const seen = new Set<string>();
  const varied: QwendoEvent[] = [];

  for (const event of withArtwork) {
    const category = event.categories?.[0] ?? "community";
    if (seen.has(category)) continue;
    seen.add(category);
    varied.push(event);
    if (varied.length === count) return varied;
  }

  // Top up with whatever is left if the catalogue is narrow today.
  for (const event of withArtwork) {
    if (varied.length === count) break;
    if (!varied.includes(event)) varied.push(event);
  }
  return varied;
}

export function HeroCollage({ events }: { events: QwendoEvent[] }) {
  const posters = pickVaried(events, SLOTS.length);
  if (posters.length < 4) return null;

  return (
    // Stops above the facts strip so posters never bleed across it.
    <div className="absolute inset-x-0 top-0 hidden h-[calc(100%-6rem)] overflow-hidden lg:block">
      {posters.map((event, index) => {
        const slot = SLOTS[index];
        const badge = formatDayBadge(event.starts_at);

        return (
          <Link
            key={event.id}
            href={`/events/${event.id}`}
            tabIndex={-1}
            aria-hidden="true"
            title={event.title}
            className={`group absolute ${slot.position} ${slot.size} ${slot.dim} transition-opacity duration-300 hover:opacity-100`}
            style={{ animation: `float ${9 + (index % 4)}s ease-in-out ${index * 0.5}s infinite` }}
          >
            <span
              className={`block overflow-hidden rounded-xl shadow-[0_24px_50px_-20px_rgb(0_0_0/0.95)] ring-1 ring-mist-100/10 transition-transform duration-300 ${slot.tilt} group-hover:rotate-0 group-hover:scale-[1.03]`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={event.image_url!}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-[3/4] w-full object-cover"
              />
            </span>

            {/* Caption sits below the artwork — never over it. Two lines of
                title, because one line truncates most event names to nothing. */}
            <span className="mt-2.5 block px-0.5">
              <span className="line-clamp-2 text-[0.6875rem] font-semibold leading-snug text-mist-200">
                {event.title}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-[0.625rem] font-medium text-mist-500">
                <span className="h-1 w-1 shrink-0 rounded-full bg-iris-400" />
                <span className="truncate">
                  {badge.day} {badge.month} ·{" "}
                  {categoryLabel(event.categories?.[0] ?? "community")}
                </span>
              </span>
            </span>
          </Link>
        );
      })}

      {/* Keeps the centre dark so headline contrast never drops, and fades the
          composition out towards every edge. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(52%_56%_at_50%_44%,rgb(8_9_12/0.95)_30%,rgb(8_9_12/0.6)_58%,transparent_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-ink-950 to-transparent" />
    </div>
  );
}
