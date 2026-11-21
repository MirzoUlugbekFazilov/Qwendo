"use client";

import { CheckIcon } from "@/components/icons";
import { categoryLabel } from "@/lib/format";
import type { Interest } from "@/lib/types";

/** Grouped, multi-select interest chips used in onboarding and the landing demo. */
export function InterestChips({
  interests,
  selected,
  onToggle,
  max = 60,
}: {
  interests: Interest[];
  selected: string[];
  onToggle: (slug: string) => void;
  max?: number;
}) {
  const groups = interests.reduce<Record<string, Interest[]>>((accumulator, interest) => {
    (accumulator[interest.category] ??= []).push(interest);
    return accumulator;
  }, {});

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([category, items]) => (
        <fieldset key={category} className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-[0.18em] text-mist-500">
            {categoryLabel(category)}
          </legend>
          <div className="flex flex-wrap gap-2">
            {items.map((interest) => {
              const isSelected = selected.includes(interest.slug);
              const atLimit = !isSelected && selected.length >= max;
              return (
                <button
                  key={interest.slug}
                  type="button"
                  onClick={() => onToggle(interest.slug)}
                  disabled={atLimit}
                  aria-pressed={isSelected}
                  className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-pill border px-3.5 py-2 text-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
                    isSelected
                      ? "border-iris-400/70 bg-iris-500/15 text-iris-200 shadow-[0_6px_20px_-12px_rgb(139_92_246/0.9)]"
                      : "border-ink-700 bg-ink-850 text-mist-300 hover:border-ink-500 hover:bg-ink-800 hover:text-mist-100"
                  }`}
                >
                  {isSelected && <CheckIcon className="h-3.5 w-3.5" />}
                  {interest.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
