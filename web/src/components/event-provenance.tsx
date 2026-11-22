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
