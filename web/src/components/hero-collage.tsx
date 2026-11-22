import Link from "next/link";

import { categoryLabel, eventZone, formatDayBadge } from "@/lib/format";
import type { QwendoEvent } from "@/lib/types";

/**
 * Cards from the live catalogue, arranged either side of the hero.
 *
 * Rules this layout follows:
 *   1. Landscape frames. Marketplace artwork is almost always a wide banner,
 *      so cropping it into a portrait poster guillotines the event's own
 *      title — "UNDAY 22 NOVEMBE", "EAM TICKETS AV". A 16:10 frame matches
 *      the source material and matches the cards used everywhere else.
 *   2. Nothing is drawn over the artwork.
 *   3. Captions are wider than they need to be and never truncate mid-word,
 *      so the event name is readable rather than hinted at.
 *   4. The centre column stays clear and nothing is clipped by the edge.
 */

type Slot = { position: string; size: string; tilt: string; dim: string };

// Outer margins only, with room beneath each card for a two-line caption.
//
// The inset tightens as the viewport grows: at lg the headline is nearly as
// wide as the screen, so cards must hug the edge, while from xl upward there
// is slack to pull them toward the centre and close the empty gutters.
const LEFT_SLOTS: Slot[] = [
  { position: "left-[2%] xl:left-[5%] 2xl:left-[8%] top-[8%]", size: "w-[13rem]", tilt: "-rotate-[5deg]", dim: "opacity-80" },
  { position: "left-[5%] xl:left-[8%] 2xl:left-[11%] top-[38%]", size: "w-[12rem]", tilt: "rotate-[4deg]", dim: "opacity-65" },
  { position: "left-[1%] xl:left-[4%] 2xl:left-[7%] top-[66%]", size: "w-[11rem]", tilt: "-rotate-[3deg]", dim: "opacity-45" },
];

const RIGHT_SLOTS: Slot[] = [
  { position: "right-[2%] xl:right-[5%] 2xl:right-[8%] top-[10%]", size: "w-[13rem]", tilt: "rotate-[5deg]", dim: "opacity-80" },
  { position: "right-[5%] xl:right-[8%] 2xl:right-[11%] top-[40%]", size: "w-[12rem]", tilt: "-rotate-[4deg]", dim: "opacity-65" },
  { position: "right-[1%] xl:right-[4%] 2xl:right-[7%] top-[68%]", size: "w-[11rem]", tilt: "rotate-[3deg]", dim: "opacity-45" },
];

const SLOTS = [...LEFT_SLOTS, ...RIGHT_SLOTS];

/** Events are chosen by the page, so it knows which ones to keep out of the grid. */
export function HeroCollage({ events }: { events: QwendoEvent[] }) {
  const cards = events.slice(0, SLOTS.length);
  if (cards.length < 4) return null;

  return (
    <div className="absolute inset-x-0 top-0 hidden h-full lg:block">
      {cards.map((event, index) => {
        const slot = SLOTS[index];
        const badge = formatDayBadge(event.starts_at, eventZone(event));

        return (
          <Link
            key={event.id}
            href={`/events/${event.id}`}
            tabIndex={-1}
            aria-hidden="true"
            title={event.title}
            className={`group absolute ${slot.position} ${slot.size} ${slot.dim} transition-opacity duration-300 hover:opacity-100`}
            style={{ animation: `float ${9 + (index % 3)}s ease-in-out ${index * 0.6}s infinite` }}
          >
            {/* `contain`, not `cover`. Marketplace artwork arrives in every
                aspect ratio, and cropping to fill always slices somebody's
                title or logo. Letterboxing against the card background keeps
                every poster whole and centred. */}
            <span
              className={`flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-ink-850 to-ink-900 p-1.5 shadow-[0_26px_55px_-22px_rgb(0_0_0/0.95)] ring-1 ring-mist-100/10 transition-transform duration-300 ${slot.tilt} group-hover:rotate-0 group-hover:scale-[1.03]`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={event.image_url!}
                alt=""
                loading="lazy"
                decoding="async"
                className="max-h-full max-w-full rounded-md object-contain"
              />
            </span>

            <span className="mt-2.5 block px-0.5">
              <span className="line-clamp-2 text-xs font-semibold leading-snug text-mist-200">
                {event.title}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-[0.6875rem] font-medium text-mist-500">
                <span className="h-1 w-1 shrink-0 rounded-full bg-iris-400" />
                {badge.day} {badge.month} · {categoryLabel(event.categories?.[0] ?? "community")}
              </span>
            </span>
          </Link>
        );
      })}

      {/* Keeps the centre dark so headline contrast never drops, and fades the
          composition out towards every edge. */}
      <div className="collage-vignette pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-ink-950 to-transparent" />
    </div>
  );
}
