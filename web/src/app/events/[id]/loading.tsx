export default function EventLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="skeleton mb-6 h-4 w-40 rounded" />
      <div className="skeleton mb-8 aspect-[21/9] w-full rounded-card" />
      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="skeleton h-10 w-3/4 rounded-lg" />
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-4 w-5/6 rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
        </div>
        <div className="skeleton h-72 rounded-card" />
      </div>
    </div>
  );
}
