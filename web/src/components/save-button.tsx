"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { BookmarkIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

type Props = {
  eventId: string;
  initiallySaved?: boolean;
  /** Compact icon button for cards, labelled button for the detail page. */
  variant?: "icon" | "full";
};

export function SaveButton({ eventId, initiallySaved = false, variant = "icon" }: Props) {
  const [saved, setSaved] = useState(initiallySaved);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function toggle(clickEvent: React.MouseEvent) {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.push(`/login?next=/events/${eventId}`);
      return;
    }

    const next = !saved;
    setSaved(next); // optimistic
    startTransition(async () => {
      try {
        if (next) {
          await api.save(session.access_token, eventId);
        } else {
          await api.unsave(session.access_token, eventId);
        }
        router.refresh();
      } catch {
        setSaved(!next); // roll back
      }
    });
  }

  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={saved}
        className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-ink-700 bg-ink-850 px-5 text-sm font-medium text-mist-200 transition-colors duration-200 hover:border-ink-600 hover:text-mist-100 disabled:opacity-60"
      >
        <BookmarkIcon filled={saved} className="h-4 w-4" />
        {saved ? "Saved" : "Save for later"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved" : "Save event"}
      className="grid h-11 w-11 cursor-pointer place-items-center rounded-full border border-ink-700 bg-ink-950/80 text-mist-300 backdrop-blur transition-colors duration-200 hover:border-amber-400 hover:text-amber-400 disabled:opacity-60"
    >
      <BookmarkIcon filled={saved} className="h-4.5 w-4.5" />
    </button>
  );
}
