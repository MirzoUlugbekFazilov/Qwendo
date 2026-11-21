"use client";

import { useCallback, useState } from "react";

/**
 * Remote artwork that fades in once decoded.
 *
 * A grid of marketplace images otherwise snaps in one frame at a time, which
 * reads as the page glitching. Isolated as a client component so the card
 * around it stays server-rendered.
 */
export function EventImage({ src, className = "" }: { src: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);

  // A cached image can finish loading before React attaches onLoad, which
  // would leave it stuck at opacity 0 — so check `complete` on mount too.
  const attach = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) setLoaded(true);
  }, []);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={attach}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      data-loaded={loaded}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
      className={`img-fade ${className}`}
    />
  );
}
