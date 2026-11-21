"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CATEGORY_LABELS } from "@/lib/format";

const WHEN_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

export function FilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const activeCategories = params.getAll("categories");
  const when = params.get("when") ?? "";
  const freeOnly = params.get("free_only") === "true";

  function update(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("offset");
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function toggleCategory(slug: string) {
    update((next) => {
      const current = next.getAll("categories");
      next.delete("categories");
      const updated = current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug];
      updated.forEach((item) => next.append("categories", item));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        {Object.entries(CATEGORY_LABELS).map(([slug, label]) => {
          const active = activeCategories.includes(slug);
          return (
            <button
              key={slug}
              type="button"
              onClick={() => toggleCategory(slug)}
              aria-pressed={active}
              className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-200 ${
                active
                  ? "border-amber-400 bg-amber-400/12 text-amber-300"
                  : "border-ink-700 bg-ink-850 text-mist-300 hover:border-ink-600 hover:text-mist-100"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="when" className="text-sm text-mist-400">
            When
          </label>
          <select
            id="when"
            value={when}
            onChange={(event) =>
              update((next) => {
                if (event.target.value) next.set("when", event.target.value);
                else next.delete("when");
              })
            }
            className="h-10 cursor-pointer rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-mist-200 transition-colors duration-200 hover:border-ink-600 focus:outline-none"
          >
            {WHEN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() =>
            update((next) => {
              if (freeOnly) next.delete("free_only");
              else next.set("free_only", "true");
            })
          }
          aria-pressed={freeOnly}
          className={`h-10 cursor-pointer rounded-lg border px-4 text-sm transition-colors duration-200 ${
            freeOnly
              ? "border-amber-400 bg-amber-400/12 text-amber-300"
              : "border-ink-700 bg-ink-850 text-mist-300 hover:border-ink-600 hover:text-mist-100"
          }`}
        >
          Free only
        </button>

        {(activeCategories.length > 0 || when || freeOnly) && (
          <button
            type="button"
            onClick={() =>
              update((next) => {
                next.delete("categories");
                next.delete("when");
                next.delete("free_only");
              })
            }
            className="h-10 cursor-pointer px-2 text-sm text-mist-500 underline-offset-4 transition-colors duration-200 hover:text-mist-200 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
