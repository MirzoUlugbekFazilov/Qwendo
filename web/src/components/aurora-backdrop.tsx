/**
 * Slow-drifting colour fields behind a section.
 *
 * Blurred blobs on long, offset cycles, so the background never settles into a
 * repeating loop a viewer can spot. Animation is transform and opacity only —
 * both composite on the GPU, so this costs nothing in layout or paint, and
 * `prefers-reduced-motion` stops it outright via the global rule.
 *
 * Purely decorative: no JavaScript, no hydration, hidden from assistive tech.
 *
 * NOTE: the `drift-*` keyframes are declared outside Tailwind's @theme block.
 * v4 only emits keyframes from @theme that an `--animate-*` variable
 * references, so defining them there silently drops the rule.
 */

type Orb = { className: string; animation: string; delay: string };

const VARIANTS: Record<"hero" | "section", Orb[]> = {
  hero: [
    {
      className: "orb -left-[10%] -top-[25%] h-[38rem] w-[38rem] bg-iris-600/22",
      animation: "drift-a 26s ease-in-out infinite",
      delay: "0s",
    },
    {
      className: "orb -right-[12%] -top-[15%] h-[32rem] w-[32rem] bg-moss-500/14",
      animation: "drift-b 34s ease-in-out infinite",
      delay: "-6s",
    },
    {
      className: "orb bottom-[-30%] left-[30%] h-[30rem] w-[30rem] bg-iris-500/18",
      animation: "drift-c 42s ease-in-out infinite",
      delay: "-14s",
    },
  ],
  // Wider, calmer and placed away from the centre: this sits behind reading
  // content, so it lifts the panel off flat black without pulling the eye.
  section: [
    {
      className: "orb -left-[18%] top-[-20%] h-[34rem] w-[46rem] bg-iris-600/26",
      animation: "drift-b 38s ease-in-out infinite",
      delay: "-4s",
    },
    {
      className: "orb -right-[16%] bottom-[-25%] h-[32rem] w-[44rem] bg-moss-500/20",
      animation: "drift-c 46s ease-in-out infinite",
      delay: "-18s",
    },
    {
      className: "orb left-[38%] top-[25%] h-[26rem] w-[34rem] bg-iris-500/16",
      animation: "drift-a 52s ease-in-out infinite",
      delay: "-9s",
    },
  ],
};

export function AuroraBackdrop({
  className = "",
  variant = "hero",
}: {
  className?: string;
  variant?: "hero" | "section";
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      {VARIANTS[variant].map((orb, index) => (
        <span
          key={index}
          className={orb.className}
          style={{ animation: orb.animation, animationDelay: orb.delay }}
        />
      ))}

      {/* A tinted section with hard edges reads as a slab pasted onto the page.
          Fading the colour out at the top and bottom lets it dissolve into the
          sections either side, so there is no seam to notice. */}
      {variant === "section" && (
        <>
          <span className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink-950 to-transparent" />
          <span className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-950 to-transparent" />
        </>
      )}
    </div>
  );
}
