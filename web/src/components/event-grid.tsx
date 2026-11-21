import { EventCard } from "@/components/event-card";
import { CompassIcon } from "@/components/icons";
import type { QwendoEvent } from "@/lib/types";

export function EventGrid({
  events,
  savedIds = [],
  showReason = true,
}: {
  events: QwendoEvent[];
  savedIds?: string[];
  showReason?: boolean;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          saved={savedIds.includes(event.id)}
          showReason={showReason}
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="surface flex flex-col items-center gap-4 rounded-card px-6 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-ink-800 text-moss-400">
        <CompassIcon className="h-6 w-6" />
      </span>
      <div className="space-y-1.5">
        <h3 className="font-display text-lg font-semibold text-mist-100">{title}</h3>
        <p className="mx-auto max-w-md text-sm text-mist-400">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function EventGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="surface overflow-hidden rounded-card" aria-hidden="true">
          <div className="aspect-[16/9] w-full skeleton" />
          <div className="space-y-3 p-5">
            <div className="h-3 w-24 skeleton rounded" />
            <div className="h-4 w-full skeleton rounded" />
            <div className="h-4 w-2/3 skeleton rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
