"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ArrowRightIcon } from "@/components/icons";
import { InterestChips } from "@/components/interest-chips";
import { api } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { Interest, Me } from "@/lib/types";

const CITIES = [
  "London",
  "Manchester",
  "Birmingham",
  "Edinburgh",
  "Bristol",
  "New York",
  "San Francisco",
  "Berlin",
  "Paris",
  "Amsterdam",
  "Dubai",
  "Tashkent",
];

export function OnboardingForm({ interests, me }: { interests: Interest[]; me: Me | null }) {
  const [selected, setSelected] = useState<string[]>(me?.interests ?? []);
  const [city, setCity] = useState(me?.profile.city ?? "London");
  const [freeText, setFreeText] = useState(me?.profile.interest_text ?? "");
  const [radius, setRadius] = useState(me?.profile.radius_km ?? 40);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function toggle(slug: string) {
    setSelected((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login?next=/onboarding");
        return;
      }

      await api.updateInterests(session.access_token, {
        interests: selected,
        interest_text: freeText.trim() || null,
        city,
      });
      await api.updateProfile(session.access_token, { radius_km: radius });

      router.push("/discover");
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message || "Could not save your interests.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <div>
          <h2 className="font-display text-xl font-semibold text-mist-100">
            1. What should we watch for?
          </h2>
          <p className="text-sm text-mist-400">
            Selected {selected.length} {selected.length === 1 ? "interest" : "interests"}. More
            interests means a wider net — you can change this any time.
          </p>
        </div>
        <InterestChips interests={interests} selected={selected} onToggle={toggle} />
      </section>

      <section className="space-y-5">
        <div>
          <h2 className="font-display text-xl font-semibold text-mist-100">2. Where are you?</h2>
          <p className="text-sm text-mist-400">We rank nearby events higher, plus anything online.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="city" className="block text-sm font-medium text-mist-300">
              City
            </label>
            <select
              id="city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className="h-12 w-full cursor-pointer rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-mist-100 transition-colors duration-200 focus:border-moss-400 focus:outline-none"
            >
              {CITIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="radius" className="block text-sm font-medium text-mist-300">
              Travel radius: <span className="text-moss-300">{radius} km</span>
            </label>
            <input
              id="radius"
              type="range"
              min={5}
              max={200}
              step={5}
              value={radius}
              onChange={(event) => setRadius(Number(event.target.value))}
              className="h-12 w-full cursor-pointer accent-moss-400"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-mist-100">
            3. Anything specific? <span className="text-mist-500">(optional)</span>
          </h2>
          <p className="text-sm text-mist-400">
            Artists, teams, franchises, communities — write it like you&apos;d tell a friend.
          </p>
        </div>
        <textarea
          id="interest-text"
          value={freeText}
          onChange={(event) => setFreeText(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Huge Spider-Man fan, into AI startups, trying to get into running this year…"
          className="w-full rounded-xl border border-ink-700 bg-ink-900 p-4 text-sm text-mist-100 placeholder:text-mist-500 transition-colors duration-200 focus:border-moss-400 focus:outline-none"
        />
      </section>

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={save}
          disabled={saving || selected.length === 0}
          className="btn btn-primary h-12 px-7"
        >
          {saving ? "Saving…" : "Save and see my feed"}
          <ArrowRightIcon className="h-4 w-4" />
        </button>
        {selected.length === 0 && (
          <span className="text-sm text-mist-500">Pick at least one interest to continue.</span>
        )}
      </div>
    </div>
  );
}
