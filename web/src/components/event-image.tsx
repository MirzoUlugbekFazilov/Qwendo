"use client";

import { useCallback, useState } from "react";

/**
 * Event artwork shown whole, on a blurred bed of itself.
 *
 * Marketplace artwork arrives in every aspect ratio. `object-cover` fills the
 * frame but guillotines whatever sits near an edge — which on an event poster
 * is usually the title. `object-contain` keeps it intact but leaves dead bars.
 * Scaling a blurred copy behind the contained image gives a full-bleed frame
 * with nothing cropped, the trick streaming services use for mixed-ratio art.
 */
export function EventImage({ src, className = "" }: { src: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);

  // A cached image can finish before React attaches onLoad, which would leave
  // it stuck at opacity 0 — so check `complete` on mount too.
  const attach = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) setLoaded(true);
  }, []);

  return (
    <span className={`absolute inset-0 block overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full scale-125 object-cover opacity-45 blur-2xl"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={attach}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        data-loaded={loaded}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className="img-fade relative h-full w-full object-contain"
      />
    </span>
  );
}
