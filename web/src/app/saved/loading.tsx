import { EventGridSkeleton } from "@/components/event-grid";

export default function SavedLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 space-y-2">
        <div className="skeleton h-9 w-48 rounded-lg" />
        <div className="skeleton h-4 w-40 rounded" />
      </div>
      <EventGridSkeleton count={3} />
    </div>
  );
}
