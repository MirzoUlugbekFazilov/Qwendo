import { EventGridSkeleton } from "@/components/event-grid";

/**
 * Streamed immediately while the server fetches recommendations, so a cold
 * backend shows the page shell instead of a blank tab.
 */
export default function DiscoverLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 space-y-6">
        <div className="skeleton h-16 w-full rounded-2xl" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="skeleton h-8 w-24 rounded-pill" />
          ))}
        </div>
      </div>

      <div className="mb-6 space-y-2">
        <div className="skeleton h-8 w-56 rounded-lg" />
        <div className="skeleton h-4 w-32 rounded" />
      </div>

      <EventGridSkeleton count={6} />
    </div>
  );
}
