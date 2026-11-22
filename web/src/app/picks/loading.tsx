import { EventGridSkeleton } from "@/components/event-grid";

export default function PicksLoading() {
  return <section className="mx-auto max-w-7xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
    <h1 className="font-display text-4xl font-bold">Your picks</h1>
    <p role="status" className="text-mist-400">Finding events for your interests and checking your Radar…</p>
    <EventGridSkeleton count={3} />
  </section>;
}
