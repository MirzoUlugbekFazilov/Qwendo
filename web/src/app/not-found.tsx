import Link from "next/link";

export default function NotFound() {
  return (
    <div className="aurora grid min-h-[60dvh] place-items-center px-4 text-center">
      <div className="space-y-4">
        <p className="font-display text-sm font-semibold tracking-[0.2em] text-amber-400">404</p>
        <h1 className="font-display text-3xl font-bold text-mist-100">
          That event has left the building
        </h1>
        <p className="mx-auto max-w-md text-mist-400">
          It may have sold out, been cancelled, or already happened — exactly the problem Qwendo
          exists to solve.
        </p>
        <Link
          href="/discover"
          className="inline-flex h-11 cursor-pointer items-center rounded-xl bg-amber-400 px-5 text-sm font-semibold text-ink-950 transition-colors duration-200 hover:bg-amber-300"
        >
          Find something else
        </Link>
      </div>
    </div>
  );
}
