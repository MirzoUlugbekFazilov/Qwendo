import Link from "next/link";

import { EventImage } from "@/components/event-image";
import { CheckIcon, ClockIcon, MapPinIcon, SparklesIcon } from "@/components/icons";
import { provenanceSummary } from "@/components/event-provenance";
import { SaveButton } from "@/components/save-button";
import {
  SOURCE_LABELS,
  categoryLabel,
  calendarLabel,
  eventZone,
  formatDayBadge,
  formatPrice,
  formatTime,
  locationLabel,
  matchPercent,
} from "@/lib/format";
import type { QwendoEvent } from "@/lib/types";

/** Artwork placeholder tint per category — keeps an imageless grid from looking broken. */
const CATEGORY_TINT: Record<string, string> = {
  tech: "from-iris-500/40 to-ink-900",
  business: "from-sky-500/30 to-ink-900",
  music: "from-fuchsia-500/35 to-ink-900",
  film: "from-rose-500/30 to-ink-900",
  gaming: "from-moss-500/35 to-ink-900",
  arts: "from-violet-500/30 to-ink-900",
  comedy: "from-orange-500/30 to-ink-900",
  sports: "from-lime-500/30 to-ink-900",
  food: "from-amber-500/30 to-ink-900",
  wellness: "from-teal-500/30 to-ink-900",
  community: "from-cyan-500/30 to-ink-900",
  nightlife: "from-purple-500/35 to-ink-900",
  education: "from-blue-500/30 to-ink-900",
  family: "from-pink-500/30 to-ink-900",
};

/** A single coloured dot makes a long grid scannable by category at a glance. */
const CATEGORY_DOT: Record<string, string> = {
  tech: "bg-iris-400",
  business: "bg-sky-400",
  music: "bg-fuchsia-400",
  film: "bg-rose-400",
  gaming: "bg-moss-400",
  arts: "bg-violet-400",
  comedy: "bg-orange-400",
  sports: "bg-lime-400",
  food: "bg-amber-400",
  wellness: "bg-teal-400",
  community: "bg-cyan-400",
  nightlife: "bg-purple-400",
  education: "bg-blue-400",
  family: "bg-pink-400",
};

export function EventCard({
  event,
  saved = false,
  showReason = true,
  quickSave = true,
  actions,
}: {
  event: QwendoEvent;
  saved?: boolean;
  showReason?: boolean;
  /** Off where the surface has its own save control, so there is only one. */
  quickSave?: boolean;
  /** Row of controls pinned under the card's footer (For You, for example). */
  actions?: React.ReactNode;
}) {
  const badge = formatDayBadge(event.starts_at, eventZone(event));
  const match = matchPercent(event);
  const category = event.categories?.[0] ?? "community";
  const tint = CATEGORY_TINT[category] ?? "from-ink-700 to-ink-900";
  const dot = CATEGORY_DOT[category] ?? "bg-mist-500";
  const soon = calendarLabel(event.starts_at, eventZone(event));
  const verified = event.verification_status === "verified" || !!event.last_verified_at;

  return (
    <article className="surface surface-hover gradient-ring group relative flex flex-col overflow-hidden rounded-card">
      {/* Whole card is the link; interactive children sit above it on z-20. */}
      <Link
        href={`/events/${event.id}`}
        className="absolute inset-0 z-10"
        aria-label={`View details for ${event.title}`}
      />

      <div className={`relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br ${tint}`}>
        {event.image_url ? (
          <EventImage
            src={event.image_url}
            className="transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <span className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-mist-400/60">
              {categoryLabel(category)}
            </span>
          </div>
        )}

        {/* Scrim keeps the date chip legible over any artwork. */}
        <div
          className="image-scrim absolute inset-x-0 top-0 h-24"
          aria-hidden="true"
        />

        <div className="absolute left-3 top-3 flex flex-col items-center rounded-xl border border-ink-700/80 bg-ink-950/85 px-2.5 py-1.5 backdrop-blur-sm">
          <span className="font-display text-lg font-extrabold leading-none text-mist-100">
            {badge.day}
          </span>
          <span className="mt-0.5 text-[0.625rem] font-bold tracking-[0.12em] text-mist-400">
            {badge.month}
          </span>
        </div>

        {quickSave && (
          <div className="absolute right-3 top-3 z-20">
            <SaveButton eventId={event.id} initiallySaved={saved} />
          </div>
        )}

        {match !== null && (
          <div className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-pill border border-iris-400/35 bg-ink-950/85 px-2.5 py-1 backdrop-blur-sm">
            <SparklesIcon className="h-3.5 w-3.5 text-iris-300" />
            <span className="text-xs font-semibold text-iris-200">{match}% match</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-mist-300">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
            {categoryLabel(category)}
          </span>
          <span
            className="inline-flex items-center gap-1 font-medium text-mist-400"
          >
            <ClockIcon className="h-3.5 w-3.5" />
            {soon} · {formatTime(event.starts_at, eventZone(event))}
          </span>
        </div>

        <h3 className="font-display text-[1.0625rem] font-bold leading-snug text-mist-100 transition-colors duration-200 group-hover:text-iris-200">
          <span className="line-clamp-2">{event.title}</span>
        </h3>

        <p className="inline-flex items-start gap-1.5 text-sm text-mist-400">
          <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-mist-500" />
          <span className="line-clamp-1">{locationLabel(event)}</span>
        </p>

        {showReason && event.reason && (
          <p className="line-clamp-2 border-l-2 border-iris-500/40 pl-2.5 text-xs leading-relaxed text-mist-500">
            {event.reason}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-ink-800 pt-3">
          <span className="text-sm font-bold text-moss-300">{formatPrice(event)}</span>
          {/* Provenance in one line; the full trail is the tooltip. */}
          <span
            className="inline-flex items-center gap-1 text-xs text-mist-500"
            title={provenanceSummary(event)}
          >
            {verified && <CheckIcon className="h-3.5 w-3.5 text-moss-400" />}
            {SOURCE_LABELS[event.source] ?? event.source}
          </span>
        </div>

        {actions && <div className="relative z-20">{actions}</div>}
      </div>
    </article>
  );
}
