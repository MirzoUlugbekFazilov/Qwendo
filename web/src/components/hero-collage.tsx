import { categoryLabel } from "@/lib/format";
import type { QwendoEvent } from "@/lib/types";

/**
 * Scattered, tilted posters from the live catalogue behind the hero.
 *
 * The hero visual *is* the product here: these are real events Qwendo is
 * tracking right now, not stock art. Everything is decorative — hidden from
 * assistive tech, non-interactive, and masked so headline contrast never drops.
 */

// Fixed slots keep the composition deliberate instead of random-looking, and
// keep every Tailwind class a literal so the compiler can see it.
const SLOTS = [
  "left-[1%] top-[14%] w-[8.5rem] -rotate-[9deg] opacity-40 blur-[1.5px]",
  "left-[7%] top-[46%] w-[10rem] rotate-[6deg] opacity-55",
  "left-[0%] bottom-[8%] w-[8rem] -rotate-[4deg] opacity-35 blur-[2px]",
  "left-[15%] top-[6%] w-[7rem] rotate-[11deg] opacity-30 blur-[2px]",
  "left-[19%] bottom-[16%] w-[6.5rem] -rotate-[7deg] opacity-30 blur-[2.5px]",
  "right-[1%] top-[16%] w-[9rem] rotate-[8deg] opacity-40 blur-[1.5px]",
  "right-[7%] top-[48%] w-[10rem] -rotate-[6deg] opacity-55",
  "right-[0%] bottom-[10%] w-[8rem] rotate-[5deg] opacity-35 blur-[2px]",
  "right-[16%] top-[7%] w-[7rem] -rotate-[10deg] opacity-30 blur-[2px]",
  "right-[20%] bottom-[14%] w-[6.5rem] rotate-[7deg] opacity-30 blur-[2.5px]",
];

export function HeroCollage({ events }: { events: QwendoEvent[] }) {
  const posters = events.filter((event) => event.image_url).slice(0, SLOTS.length);
  if (posters.length < 4) return null;

  return (
    <div className="pointer-events-none absolute inset-0 hidden select-none lg:block" aria-hidden="true">
      {posters.map((event, index) => (
        <figure
          key={event.id}
          className={`absolute ${SLOTS[index]}`}
          style={{ animation: `float ${8 + (index % 4)}s ease-in-out ${index * 0.4}s infinite` }}
        >
          <figcaption className="mb-1.5 truncate text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-mist-500">
            {categoryLabel(event.categories?.[0] ?? "community")}
          </figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={event.image_url!}
            alt=""
            loading="lazy"
            decoding="async"
            className="aspect-[3/4] w-full rounded-xl object-cover shadow-[0_24px_50px_-20px_rgb(0_0_0/0.95)] ring-1 ring-mist-100/10"
          />
        </figure>
      ))}

      {/* Keeps the centre column dark so the headline keeps its contrast,
          and fades the collage out at every edge. */}
      <div className="absolute inset-0 bg-[radial-gradient(62%_58%_at_50%_42%,rgb(8_9_12/0.97)_36%,rgb(8_9_12/0.74)_62%,transparent_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-ink-950 via-ink-950/80 to-transparent" />
    </div>
  );
}
