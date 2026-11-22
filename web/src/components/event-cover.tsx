import { QwendoMark } from "@/components/logo";
import { categoryLabel } from "@/lib/format";

/**
 * Cover art for an event that has none.
 *
 * Roughly a third of the catalogue arrives without artwork — the scraper only
 * keeps an image when the source publishes it under a public-domain licence,
 * so most listings legitimately have nothing to show. Leaving those cards with
 * an empty wash made them read as broken next to the ones with posters.
 *
 * So the cover is generated instead: a two-tone field in the category's own
 * colours, with the angle and highlight placement derived from the event id so
 * no two neighbours look stamped from the same mould, the Qwendo mark as a
 * watermark, and the category named in the corner. It mixes with the page
 * colour, so it belongs in either theme.
 */

/** Per-category pair: the field colour and the colour its highlight leans to. */
const PALETTE: Record<string, [string, string]> = {
  tech: ["#8b5cf6", "#38bdf8"],
  business: ["#0ea5e9", "#6366f1"],
  music: ["#d946ef", "#f43f5e"],
  film: ["#f43f5e", "#f59e0b"],
  gaming: ["#10b981", "#22d3ee"],
  arts: ["#8b5cf6", "#ec4899"],
  comedy: ["#f97316", "#facc15"],
  sports: ["#84cc16", "#10b981"],
  food: ["#f59e0b", "#ef4444"],
  wellness: ["#14b8a6", "#22c55e"],
  community: ["#06b6d4", "#3b82f6"],
  nightlife: ["#a855f7", "#6366f1"],
  education: ["#3b82f6", "#06b6d4"],
  family: ["#ec4899", "#f59e0b"],
  fashion: ["#ec4899", "#8b5cf6"],
};

const FALLBACK: [string, string] = ["#6366f1", "#14b8a6"];

/** Small, stable hash — the same event always gets the same cover. */
function seedOf(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function EventCover({ id, category }: { id: string; category: string }) {
  const [from, to] = PALETTE[category] ?? FALLBACK;
  const seed = seedOf(id);
  const angle = 110 + (seed % 7) * 20;
  const highlightX = 18 + (seed % 5) * 14;
  const highlightY = 12 + ((seed >> 3) % 4) * 12;

  return (
    <div
      className="relative h-full w-full"
      style={{
        backgroundImage: [
          // Highlight first so it sits over the field.
          `radial-gradient(72% 72% at ${highlightX}% ${highlightY}%, color-mix(in oklab, ${to} 46%, transparent), transparent 70%)`,
          `linear-gradient(${angle}deg, color-mix(in oklab, ${from} 44%, var(--color-ink-900)), color-mix(in oklab, ${to} 22%, var(--color-ink-900)))`,
        ].join(", "),
      }}
    >
      <QwendoMark className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 opacity-35" />

      <span className="absolute bottom-3 right-3 font-display text-[0.625rem] font-bold uppercase tracking-[0.2em] text-mist-400">
        {categoryLabel(category)}
      </span>
    </div>
  );
}
