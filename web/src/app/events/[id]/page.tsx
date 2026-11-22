import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventGrid } from "@/components/event-grid";
import { getRelevance } from "@/components/picks-api";
import { CalendarIcon, ClockIcon, GlobeIcon, MapPinIcon, TicketIcon } from "@/components/icons";
import { SaveButton } from "@/components/save-button";
import { officialLinks, sourceListing } from "@/components/picks-model";
import { EventProvenance } from "@/components/event-provenance";
import { TicketLink } from "@/components/ticket-link";
import { ApiError, EMPTY_LIST, api, safe } from "@/lib/api";
import {
  SOURCE_LABELS,
  categoryLabel,
  calendarLabel,
  eventZone,
  formatDate,
  formatPrice,
} from "@/lib/format";
import { getAccessToken } from "@/lib/supabase/server";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const event = await api.event(id);
    return {
      title: event.title,
      description: event.summary ?? `${event.title} — event details on Qwendo.`,
      openGraph: {
        title: event.title,
        description: event.summary ?? "",
        images: event.image_url ? [event.image_url] : undefined,
      },
    };
  } catch {
    return { title: "Event" };
  }
}

export default async function EventPage({ params }: Props) {
  const { id } = await params;

  let event;
  try {
    event = await api.event(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const token = await getAccessToken();
  const [saved, similar, match] = await Promise.all([
    token ? safe(api.saved(token), EMPTY_LIST) : Promise.resolve(EMPTY_LIST),
    safe(
      api.events({
        city: event.city ?? undefined,
        categories: event.categories?.slice(0, 1),
        limit: 7,
      }),
      EMPTY_LIST,
    ),
    token ? safe(getRelevance(token, event.id), null) : null,
  ]);

  const isSaved = saved.items.some((item) => item.id === event.id);
  const related = similar.items.filter((item) => item.id !== event.id).slice(0, 3);
  const sourceLabel = SOURCE_LABELS[event.source] ?? event.source;
  const [officialUrl] = officialLinks(event);
  const listingUrl = sourceListing(event);

  return (
    <article className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-mist-500">
        <Link href="/discover" className="cursor-pointer transition-colors hover:text-mist-200">
          Discover
        </Link>
        <span className="mx-2">/</span>
        <span className="text-mist-300">{categoryLabel(event.categories?.[0] ?? "community")}</span>
      </nav>

      <div
        className={`relative mb-8 aspect-[21/9] w-full overflow-hidden rounded-card ${
          event.image_url ? "" : "aurora surface"
        }`}
      >
        {event.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.image_url}
            alt=""
            className="h-full w-full object-cover"
            decoding="async"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <TicketIcon className="h-12 w-12 text-moss-400/70" />
          </div>
        )}
      </div>

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          <header className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(event.categories ?? []).map((category) => (
                <span
                  key={category}
                  className="rounded-md bg-ink-800 px-2.5 py-1 font-medium text-mist-300"
                >
                  {categoryLabel(category)}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 rounded-md border border-moss-400/30 bg-moss-400/10 px-2.5 py-1 font-medium text-moss-300">
                <ClockIcon className="h-3.5 w-3.5" />
                {calendarLabel(event.starts_at, eventZone(event))}
              </span>
            </div>

            <h1 className="font-display text-3xl font-bold text-mist-100 sm:text-4xl">
              {event.title}
            </h1>

            {event.organizer && event.organizer.trim().toLowerCase() !== event.source && (
              <p className="text-sm text-mist-400">Organised by {event.organizer}</p>
            )}
          </header>

          {match && (match.reason || match.matched_interest) && (
            <section className="surface space-y-2 rounded-card p-5">
              <h2 className="font-display text-lg font-semibold">Why this is in your picks</h2>
              {match.reason && <p>{match.reason}</p>}
              {match.matched_interest && <p className="text-sm text-mist-400">Matched interest · {match.matched_interest}</p>}
              <Link href="/picks" className="text-sm text-iris-200 underline">View your picks</Link>
            </section>
          )}

          {(
            <section className="space-y-3">
              <h2 className="font-display text-lg font-semibold text-mist-100">About this event</h2>
              <p className="whitespace-pre-line text-[0.95rem] leading-relaxed text-mist-300">
                {event.description || event.summary || "No overview provided."}
              </p>
            </section>
          )}

          {event.tags?.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-semibold text-mist-100">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {event.tags.slice(0, 12).map((tag) => (
                  <Link
                    key={tag}
                    href={`/discover?q=${encodeURIComponent(tag)}`}
                    className="cursor-pointer rounded-full border border-ink-700 px-3 py-1 text-xs text-mist-400 transition-colors duration-200 hover:border-moss-400/50 hover:text-moss-300"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sticky booking rail */}
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <div className="surface space-y-5 rounded-card p-6">
            <dl className="space-y-4 text-sm">
              <div className="flex gap-3">
                <CalendarIcon className="mt-0.5 h-4.5 w-4.5 shrink-0 text-moss-400" />
                <div>
                  <dt className="text-mist-500">Starts</dt>
                  <dd className="font-medium text-mist-100">
                    {formatDate(event.starts_at, eventZone(event))}
                    {event.ends_at && <span className="block">Ends {formatDate(event.ends_at, eventZone(event, event.ends_at))}</span>}
                  </dd>
                </div>
              </div>

              <div className="flex gap-3">
                {event.is_online ? (
                  <GlobeIcon className="mt-0.5 h-4.5 w-4.5 shrink-0 text-moss-400" />
                ) : (
                  <MapPinIcon className="mt-0.5 h-4.5 w-4.5 shrink-0 text-moss-400" />
                )}
                <div>
                  <dt className="text-mist-500">{event.is_online ? "Format" : "Venue"}</dt>
                  <dd className="font-medium text-mist-100">
                    {event.is_online ? "Online event" : (event.venue_name || event.address || `Check ${sourceLabel} for location details`)}
                  </dd>
                  {event.address && <dd className="mt-0.5 text-mist-400">{event.address}</dd>}
                </div>
              </div>

              <div className="flex gap-3">
                <TicketIcon className="mt-0.5 h-4.5 w-4.5 shrink-0 text-moss-400" />
                <div>
                  <dt className="text-mist-500">Price</dt>
                  <dd className="font-medium text-mist-100">{formatPrice(event)}</dd>
                </div>
              </div>
            </dl>

            <div className="space-y-2.5 border-t border-ink-800 pt-5">
              {officialUrl && <TicketLink
                eventId={event.id}
                url={officialUrl}
                source={sourceLabel}
                className="btn btn-primary h-12 w-full"
              />}
              <div className="[&>button]:w-full">
                <SaveButton eventId={event.id} initiallySaved={isSaved} variant="full" />
              </div>
            </div>

            <div className="space-y-1">
              <EventProvenance event={event} />
              {listingUrl && <a href={listingUrl} target="_blank" rel="noopener noreferrer nofollow"
                className="text-sm text-iris-200 underline">Source listing</a>}
            </div>

            {!event.is_online && event.address && event.lat != null && event.lng != null && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${event.lat},${event.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-mist-400 transition-colors duration-200 hover:text-moss-300"
              >
                <MapPinIcon className="h-3.5 w-3.5" />
                Open in Maps
              </a>
            )}
          </div>
        </aside>
      </div>

      {related.length > 0 && (
        <section className="mt-16 space-y-6">
          <h2 className="font-display text-2xl font-bold text-mist-100">You might also like</h2>
          <EventGrid events={related} showReason={false} />
        </section>
      )}
    </article>
  );
}
