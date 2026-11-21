import Link from "next/link";

import { ClockIcon, MapPinIcon, SparklesIcon } from "@/components/icons";
import { SaveButton } from "@/components/save-button";
import {
  SOURCE_LABELS,
  categoryLabel,
  countdownLabel,
  formatDayBadge,
  formatPrice,
  locationLabel,
  matchPercent,
} from "@/lib/format";
import type { QwendoEvent } from "@/lib/types";

const CATEGORY_TINT: Record<string, string> = {
  tech: "from-iris-500/35",
  business: "from-sky-500/30",
  music: "from-pink-500/30",
  film: "from-red-500/30",
  gaming: "from-emerald-500/30",
  arts: "from-fuchsia-500/30",
  comedy: "from-orange-500/30",
  sports: "from-lime-500/30",
  food: "from-amber-500/30",
  wellness: "from-teal-500/30",
  community: "from-cyan-500/30",
  nightlife: "from-violet-500/35",
  education: "from-blue-500/30",
  family: "from-rose-500/30",
};

export function EventCard({
  event,
  saved = false,
  showReason = true,
}: {
  event: QwendoEvent;
  saved?: boolean;
  showReason?: boolean;
}) {
  const badge = formatDayBadge(event.starts_at);
  const match = matchPercent(event);
  const tint = CATEGORY_TINT[event.categories?.[0] ?? ""] ?? "from-ink-700";

  return (
    <article className="surface surface-hover group relative flex flex-col overflow-hidden rounded-card">
      <Link
        href={`/events/${event.id}`}
        className="absolute inset-0 z-10"
        aria-label={`View details for ${event.title}`}
      />

      {/* Artwork */}
      <div className={`relative aspect-[16/9] w-full overflow-hidden bg-gradient-to-br ${tint} to-ink-900`}>
        {event.image_url ? (
          // Remote artwork comes from many CDNs; a plain img keeps every host working.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-90"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <span className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-mist-400/70">
              {categoryLabel(event.categories?.[0] ?? "community")}
            </span>
          </div>
        )}

        <div className="absolute left-3 top-3 flex flex-col items-center rounded-xl border border-ink-700 bg-ink-950/85 px-2.5 py-1.5 backdrop-blur">
          <span className="font-display text-lg font-bold leading-none text-mist-100">{badge.day}</span>
          <span className="text-[0.625rem] font-semibold tracking-widest text-mist-400">
            {badge.month}
          </span>
        </div>

        <div className="absolute right-3 top-3 z-20">
          <SaveButton eventId={event.id} initiallySaved={saved} />
        </div>

        {match !== null && (
          <div className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-ink-950/85 px-2.5 py-1 backdrop-blur">
            <SparklesIcon className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-semibold text-amber-300">{match}% match</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-mist-400">
          <span className="rounded-md bg-ink-800 px-2 py-0.5 font-medium text-mist-300">
            {categoryLabel(event.categories?.[0] ?? "community")}
          </span>
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="h-3.5 w-3.5" />
            {countdownLabel(event.starts_at)}
          </span>
        </div>

        <h3 className="font-display text-lg font-semibold text-mist-100 transition-colors duration-200 group-hover:text-amber-300">
          <span className="line-clamp-2">{event.title}</span>
        </h3>

        <p className="inline-flex items-start gap-1.5 text-sm text-mist-400">
          <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="line-clamp-1">{locationLabel(event)}</span>
        </p>

        {showReason && event.reason && (
          <p className="line-clamp-2 text-xs leading-relaxed text-mist-500">{event.reason}</p>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-ink-800 pt-3">
          <span className="text-sm font-semibold text-mist-200">{formatPrice(event)}</span>
          <span className="text-xs text-mist-500">
            {SOURCE_LABELS[event.source] ?? event.source}
          </span>
        </div>
      </div>
    </article>
  );
}
