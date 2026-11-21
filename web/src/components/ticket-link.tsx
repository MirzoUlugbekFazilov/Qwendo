"use client";

import { ExternalLinkIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

type Props = {
  eventId: string;
  url: string;
  source: string;
  surface?: string;
  className?: string;
  children?: React.ReactNode;
};

/**
 * Outbound link to the official listing. Qwendo never sells tickets — we send
 * people to the source and log the click so the feed learns what works.
 */
export function TicketLink({
  eventId,
  url,
  source,
  surface = "detail",
  className = "",
  children,
}: Props) {
  async function handleClick() {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      // Fire and forget: tracking must never delay the outbound navigation.
      void api.trackClick(eventId, surface, session?.access_token);
    } catch {
      // analytics is best-effort
    }
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={handleClick}
      className={className || "btn btn-primary h-11 px-6"}
    >
      {children ?? (
        <>
          Get tickets on {source}
          <ExternalLinkIcon className="h-4 w-4" />
        </>
      )}
    </a>
  );
}
