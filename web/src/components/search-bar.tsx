"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MapPinIcon, SearchIcon } from "@/components/icons";

const CITIES = [
  "London",
  "Manchester",
  "Birmingham",
  "Edinburgh",
  "New York",
  "San Francisco",
  "Berlin",
  "Paris",
  "Dubai",
  "Tashkent",
];

/** Hero search: on a discovery marketplace the search field *is* the primary CTA. */
export function SearchBar({
  defaultQuery = "",
  defaultCity = "London",
  size = "lg",
}: {
  defaultQuery?: string;
  defaultCity?: string;
  size?: "lg" | "sm";
}) {
  const [query, setQuery] = useState(defaultQuery);
  const [city, setCity] = useState(defaultCity);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // "/" jumps to search from anywhere — the convention on every discovery
  // product. Ignored while the user is already typing in a field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (city) params.set("city", city);
    router.push(`/discover?${params.toString()}`);
  }

  const height = size === "lg" ? "h-14" : "h-12";

  return (
    <form
      onSubmit={submit}
      role="search"
      className="gradient-ring glass flex w-full flex-col gap-2 rounded-2xl p-2 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.9)] transition-shadow duration-300 focus-within:shadow-[0_24px_70px_-26px_rgb(124_58_237/0.45)] sm:flex-row sm:items-center"
    >
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-mist-500" />
        <label htmlFor="search-query" className="sr-only">
          What are you into?
        </label>
        <input
          id="search-query"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Spider-Man, hackathons, techno, networking…"
          className={`${height} w-full rounded-xl bg-transparent pl-12 pr-14 text-base text-mist-100 placeholder:text-mist-500 focus:outline-none`}
        />
        {!query && (
          <kbd
            className="kbd pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 sm:inline-flex"
            aria-hidden="true"
          >
            /
          </kbd>
        )}
      </div>

      <div className="relative sm:w-48">
        <MapPinIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-mist-500" />
        <label htmlFor="search-city" className="sr-only">
          City
        </label>
        <select
          id="search-city"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          className={`${height} w-full cursor-pointer appearance-none rounded-xl border border-ink-700 bg-ink-850 pl-12 pr-4 text-sm font-medium text-mist-200 transition-colors duration-200 hover:border-ink-500 focus:outline-none`}
        >
          {CITIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" className={`btn btn-primary ${height} px-7 text-[0.9375rem]`}>
        Search
      </button>
    </form>
  );
}
