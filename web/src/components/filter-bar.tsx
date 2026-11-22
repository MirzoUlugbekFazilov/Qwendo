"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CATEGORY_LABELS } from "@/lib/format";

const WHEN_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

const SORT_OPTIONS = [
  { value: "match", label: "Best match" },
  { value: "soon", label: "Starting soonest" },
];

const chip =
  "inline-flex h-9 shrink-0 cursor-pointer items-center rounded-pill border px-3.5 text-sm transition-colors duration-200";
const control =
  "h-9 cursor-pointer rounded-pill border border-ink-700 bg-ink-850 text-sm text-mist-200 transition-colors duration-200 hover:border-ink-500 hover:text-mist-100 focus:outline-none";

/**
 * Discover filters.
 *
 * Categories sit on one horizontally scrollable rail rather than wrapping to
 * two rows of chips — on a phone that block was taller than the first result.
 * Everything stays visible: a collapsed "Filters" panel hides state the user
 * has already set, which is how people end up confused about why a feed looks
 * empty.
 */
export function FilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const activeCategories = params.getAll("categories");
  const when = params.get("when") ?? "";
  const sort = params.get("sort") ?? "match";
  const freeOnly = params.get("free_only") === "true";

  const activeCount =
    activeCategories.length + (when ? 1 : 0) + (freeOnly ? 1 : 0) + (sort !== "match" ? 1 : 0);

  function update(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("offset");
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function toggleCategory(slug: string) {
    update((next) => {
      const current = next.getAll("categories");
      const updated = current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug];
      next.delete("categories");
      updated.forEach((item) => next.append("categories", item));
    });
  }

  return (
    <div className="space-y-3">
      {/* Full-bleed on phones so the rail can scroll past the page gutter. */}
      <div
        className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
        role="group"
        aria-label="Filter by category"
      >
        <button
          type="button"
          onClick={() => update((next) => next.delete("categories"))}
          aria-pressed={activeCategories.length === 0}
          className={`${chip} ${
            activeCategories.length === 0
              ? "border-mist-100 bg-mist-100 font-medium text-ink-950"
              : "border-ink-700 bg-ink-850 text-mist-300 hover:border-ink-500 hover:text-mist-100"
          }`}
        >
          All
        </button>

        {Object.entries(CATEGORY_LABELS).map(([slug, label]) => {
          const active = activeCategories.includes(slug);
          return (
            <button
              key={slug}
              type="button"
              onClick={() => toggleCategory(slug)}
              aria-pressed={active}
              className={`${chip} ${
                active
                  ? "border-iris-400/70 bg-iris-500/15 text-iris-200"
                  : "border-ink-700 bg-ink-850 text-mist-300 hover:border-ink-500 hover:bg-ink-800 hover:text-mist-100"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="When"
          value={when}
          onChange={(event) =>
            update((next) => {
              if (event.target.value) next.set("when", event.target.value);
              else next.delete("when");
            })
          }
          className={`${control} px-3.5 ${when ? "border-iris-400/70 text-iris-200" : ""}`}
        >
          {WHEN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Sort by"
          value={sort}
          onChange={(event) =>
            update((next) => {
              if (event.target.value === "match") next.delete("sort");
              else next.set("sort", event.target.value);
            })
          }
          className={`${control} px-3.5 ${sort !== "match" ? "border-iris-400/70 text-iris-200" : ""}`}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() =>
            update((next) => {
              if (freeOnly) next.delete("free_only");
              else next.set("free_only", "true");
            })
          }
          aria-pressed={freeOnly}
          className={`${chip} ${
            freeOnly
              ? "border-moss-400/70 bg-moss-400/15 font-medium text-moss-300"
              : "border-ink-700 bg-ink-850 text-mist-300 hover:border-ink-500 hover:text-mist-100"
          }`}
        >
          Free
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() =>
              update((next) => {
                next.delete("categories");
                next.delete("when");
                next.delete("free_only");
                next.delete("sort");
              })
            }
            className="h-9 cursor-pointer px-2 text-sm text-mist-500 underline-offset-4 transition-colors duration-200 hover:text-mist-200 hover:underline"
          >
            Clear {activeCount}
          </button>
        )}
      </div>
    </div>
  );
}
