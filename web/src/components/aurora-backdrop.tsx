/**
 * Slow-drifting colour fields behind a section.
 *
 * Three blurred blobs on long, offset cycles, so the background never settles
 * into a repeating loop a viewer can spot. Animation is transform and opacity
 * only — both composite on the GPU, so this costs nothing in layout or paint,
 * and `prefers-reduced-motion` stops it outright via the global rule.
 *
 * Purely decorative: no JavaScript, no hydration, hidden from assistive tech.
 */
export function AuroraBackdrop({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <span
        className="orb -left-[10%] -top-[25%] h-[38rem] w-[38rem] bg-iris-600/22"
        style={{ animation: "drift-a 26s ease-in-out infinite" }}
      />
      <span
        className="orb -right-[12%] -top-[15%] h-[32rem] w-[32rem] bg-moss-500/14"
        style={{ animation: "drift-b 34s ease-in-out infinite", animationDelay: "-6s" }}
      />
      <span
        className="orb bottom-[-30%] left-[30%] h-[30rem] w-[30rem] bg-iris-500/18"
        style={{ animation: "drift-c 42s ease-in-out infinite", animationDelay: "-14s" }}
      />
    </div>
  );
}
