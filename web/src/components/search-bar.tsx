"use client";

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

/** Cycled through the placeholder, one character at a time. */
const SUGGESTIONS = ["hackathons", "networking events", "concerts"];

const TYPE_MS = 85;
const DELETE_MS = 45;
const HOLD_MS = 1600;

/**
 * Types each suggestion into the placeholder, holds, deletes, moves on.
 *
 * Only ever touches the placeholder — never the input's value — so it cannot
 * interfere with what the user types, and it stops the moment they engage.
 * Falls back to a static string when the user prefers reduced motion.
 */
function useTypedPlaceholder(active: boolean) {
  const [text, setText] = useState(SUGGESTIONS[0]);

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let word = 0;
    let char = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const target = SUGGESTIONS[word];
      char += deleting ? -1 : 1;
      setText(target.slice(0, char));

      let delay = deleting ? DELETE_MS : TYPE_MS;
      if (!deleting && char === target.length) {
        deleting = true;
        delay = HOLD_MS;
      } else if (deleting && char === 0) {
        deleting = false;
        word = (word + 1) % SUGGESTIONS.length;
        delay = 350;
      }
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, HOLD_MS);
    return () => clearTimeout(timer);
  }, [active]);

  return text;
}

/** Hero search: on a discovery marketplace the search field *is* the primary CTA. */
export function SearchBar({
  defaultQuery = "",
  defaultCity = "London",
  size = "lg",
  filters = [],
}: {
  defaultQuery?: string;
  defaultCity?: string;
  filters?: [string, string][];
  size?: "lg" | "sm";
}) {
  const [query, setQuery] = useState(defaultQuery);
  const [city, setCity] = useState(defaultCity);
  const [engaged, setEngaged] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Stop animating once the field is focused or typed in: a moving placeholder
  // under a live cursor is a distraction, not a hint.
  const typed = useTypedPlaceholder(!engaged && !query);

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



  const height = size === "lg" ? "h-14" : "h-12";

  return (
    <form
      method="get" action="/discover"
      role="search"
      className="gradient-ring glass flex w-full flex-col gap-2 rounded-2xl p-2 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.9)] transition-shadow duration-300 focus-within:shadow-[0_24px_70px_-26px_rgb(124_58_237/0.45)] sm:flex-row sm:items-center"
    >
      {filters.map(([name, value], index) => <input key={index} type="hidden" name={name} value={value} />)}
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-mist-500" />
        <label htmlFor="search-query" className="sr-only">
          What are you into?
        </label>
        <input
          id="search-query"
          name="q"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setEngaged(true)}
          placeholder={engaged || query ? "Search events" : `Try ${typed}`}
          className={`${height} w-full rounded-xl bg-transparent pl-12 pr-4 text-base text-mist-100 placeholder:text-mist-500 focus:outline-none`}
        />
      </div>

      <div className="relative sm:w-48">
        <MapPinIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-mist-500" />
        <label htmlFor="search-city" className="sr-only">
          City
        </label>
        <select
          id="search-city"
          name="city"
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
