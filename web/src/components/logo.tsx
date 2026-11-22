import Link from "next/link";

/**
 * The Qwendo mark: a magnifying glass whose handle closes the letter Q, so the
 * wordmark reads "Qwendo" with the search itself standing in for the Q.
 *
 * Drawn rather than imported: at 36px a bitmap would be soft on every other
 * display, and the gradient stops are CSS variables so the mark deepens in the
 * light theme instead of washing out on white.
 */
export function QwendoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden="true" focusable="false">
      <defs>
        {/* One fixed id: every instance paints the identical gradient. */}
        <linearGradient id="qwendo-mark" x1="6" y1="4" x2="30" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--logo-from)" />
          <stop offset="52%" stopColor="var(--logo-via)" />
          <stop offset="100%" stopColor="var(--logo-to)" />
        </linearGradient>
      </defs>

      {/* Handle first, so the lens ring sits over the join. */}
      <path
        d="M26.4 26.4 31.4 31.4"
        fill="none"
        stroke="url(#qwendo-mark)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <circle cx="17" cy="17" r="12.9" fill="none" stroke="url(#qwendo-mark)" strokeWidth="3.2" />

      {/* Glass glint, up in the top-left quadrant where the light would fall. */}
      <path
        d="M9.84 16.25A7.2 7.2 0 0 1 15.99 9.87"
        fill="none"
        stroke="var(--logo-glint)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-0 ${className}`}
      aria-label="Qwendo home"
    >
      <QwendoMark className="h-8 w-8 shrink-0 transition-transform duration-300 group-hover:scale-105" />
      {/* The mark is the Q — the word continues from it. */}
      <span className="font-display text-2xl font-extrabold tracking-tight text-mist-100">
        wendo
      </span>
    </Link>
  );
}
