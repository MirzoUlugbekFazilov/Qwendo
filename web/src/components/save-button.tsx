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
        className={`btn h-11 px-5 ${
          saved
            ? "border border-iris-500/60 bg-iris-500/12 text-iris-200 hover:bg-iris-500/20"
            : "btn-ghost"
        }`}
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
      className={`grid h-11 w-11 cursor-pointer place-items-center rounded-full border backdrop-blur-sm transition-colors duration-200 disabled:opacity-60 ${
        saved
          ? "border-iris-400/70 bg-iris-500/20 text-iris-200"
          : "border-ink-700 bg-ink-950/75 text-mist-300 hover:border-iris-400/70 hover:text-iris-200"
      }`}
    >
      <BookmarkIcon filled={saved} className="h-4.5 w-4.5" />
    </button>
  );
}
