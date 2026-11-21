import Link from "next/link";

import { categoryLabel, formatDayBadge } from "@/lib/format";
import type { QwendoEvent } from "@/lib/types";

/**
 * Posters from the live catalogue, arranged either side of the hero.
 *
 * Three rules this layout follows:
 *   1. Nothing is clipped by the viewport edge — a half-cut poster reads as a
 *      bug, not as a design.
 *   2. The centre column stays clear. Posters live in the outer margins only,
 *      so they never fight the headline or the search field.
 *   3. They are real, and they link to the real event. The hero demonstrates
 *      the product rather than decorating around it.
 */

type Slot = { position: string; size: string; tilt: string; dim: string };

// Outer margins only: every `left`/`right` plus its width stays well inside
// the viewport, and nothing enters the middle ~55% where the text sits.
const LEFT_SLOTS: Slot[] = [
  { position: "left-[3%] top-[8%]", size: "w-[8.5rem]", tilt: "-rotate-[7deg]", dim: "opacity-75" },
  { position: "left-[9%] top-[40%]", size: "w-[7.5rem]", tilt: "rotate-[6deg]", dim: "opacity-60" },
  { position: "left-[2%] top-[66%]", size: "w-[7rem]", tilt: "-rotate-[4deg]", dim: "opacity-50" },
  {
    position: "left-[14%] top-[20%] hidden 2xl:block",
    size: "w-[6rem]",
    tilt: "rotate-[9deg]",
    dim: "opacity-40",
  },
];

const RIGHT_SLOTS: Slot[] = [
  { position: "right-[3%] top-[10%]", size: "w-[8.5rem]", tilt: "rotate-[7deg]", dim: "opacity-75" },
  { position: "right-[9%] top-[42%]", size: "w-[7.5rem]", tilt: "-rotate-[6deg]", dim: "opacity-60" },
  { position: "right-[2%] top-[68%]", size: "w-[7rem]", tilt: "rotate-[4deg]", dim: "opacity-50" },
  {
    position: "right-[14%] top-[22%] hidden 2xl:block",
    size: "w-[6rem]",
    tilt: "-rotate-[9deg]",
    dim: "opacity-40",
  },
];

const SLOTS = [...LEFT_SLOTS, ...RIGHT_SLOTS];

export function HeroCollage({ events }: { events: QwendoEvent[] }) {
  const posters = events.filter((event) => event.image_url).slice(0, SLOTS.length);
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
            <span className="mb-1.5 flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-mist-500">
              <span className="h-1 w-1 rounded-full bg-iris-400" />
              {categoryLabel(event.categories?.[0] ?? "community")}
            </span>

            <span
              className={`relative block overflow-hidden rounded-xl ring-1 ring-mist-100/10 shadow-[0_24px_50px_-20px_rgb(0_0_0/0.95)] transition-transform duration-300 ${slot.tilt} group-hover:rotate-0 group-hover:scale-[1.03]`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={event.image_url!}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-[3/4] w-full object-cover"
              />
              <span className="absolute right-1.5 top-1.5 rounded-md bg-ink-950/85 px-1.5 py-0.5 text-[0.5625rem] font-bold leading-tight text-mist-200 backdrop-blur-sm">
                {badge.day} {badge.month}
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
