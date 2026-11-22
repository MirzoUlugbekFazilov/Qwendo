import { SOURCE_LABELS } from "@/lib/format";
import type { QwendoEvent } from "@/lib/types";

export function EventProvenance({ event }: { event: QwendoEvent }) {
  const times = [["Discovered", event.first_seen_at], ["Announced", event.source_published_at],
    ["Last verified", event.last_verified_at]] as const;
  return <div className="space-y-1 text-xs text-mist-400">
    {event.source && <p>Source · {SOURCE_LABELS[event.source] ?? event.source}</p>}
    {times.map(([label, value]) => value && Number.isFinite(Date.parse(value)) &&
      <p key={label}>{label} · <time dateTime={value}>{new Date(value).toLocaleString("en-GB", {
        dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
      })} UTC</time></p>)}
  </div>;
}

/**
 * One-line version of the block above, for a card's footer.
 *
 * The cards used to print source, discovery and verification on three
 * separate lines, which crowded out the event itself. The dates matter to
 * anyone who asks, so they survive as the tooltip on the source label.
 */
export function provenanceSummary(event: QwendoEvent): string {
  const stamp = (value: string | null | undefined) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }) + " UTC"
      : null;

  return [
    event.source && `Source · ${SOURCE_LABELS[event.source] ?? event.source}`,
    stamp(event.first_seen_at) && `Discovered · ${stamp(event.first_seen_at)}`,
    stamp(event.source_published_at) && `Announced · ${stamp(event.source_published_at)}`,
    stamp(event.last_verified_at) && `Last verified · ${stamp(event.last_verified_at)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
