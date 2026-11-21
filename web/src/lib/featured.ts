import type { QwendoEvent } from "@/lib/types";

/**
 * Pick a varied set for a featured surface: one event per category first, so a
 * row shows the breadth of the catalogue rather than three of the same thing.
 *
 * Shared between the hero and the landing page, which needs to know exactly
 * which events the hero will render in order to keep them out of the trending
 * grid — excluding every *candidate* starves the grid instead.
 */
export function pickVariedEvents(events: QwendoEvent[], count: number): QwendoEvent[] {
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

/** How many cards the hero renders. */
export const HERO_CARD_COUNT = 6;
