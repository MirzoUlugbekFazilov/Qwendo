"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_THEME,
  THEME_EVENT,
  THEME_STORAGE_KEY,
  applyTheme,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

/**
 * The current theme preference and what it resolves to right now.
 *
 * `ready` stays false for the first render so server and client markup match —
 * the server cannot know a device preference, so no control may claim to be
 * selected until after hydration.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(DEFAULT_THEME);
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = (next: ThemePreference) => {
      setPreference(next);
      setResolved(resolveTheme(next));
    };

    sync(readThemePreference());
    setReady(true);

    const media = window.matchMedia("(prefers-color-scheme: light)");
    // Only "system" follows the device, but re-resolving is harmless either way.
    const onSystemChange = () => {
      const current = readThemePreference();
      if (current !== "system") return;
      setResolved(resolveTheme(current));
      applyTheme(resolveTheme(current));
    };
    // Another tab changed the preference.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = isThemePreference(event.newValue) ? event.newValue : DEFAULT_THEME;
      sync(next);
      applyTheme(resolveTheme(next));
    };
    const onThemeEvent = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail;
      if (isThemePreference(next)) sync(next);
    };

    media.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_EVENT, onThemeEvent);
    return () => {
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_EVENT, onThemeEvent);
    };
  }, []);

  return {
    preference,
    resolved,
    ready,
    choose(next: ThemePreference) {
      setPreference(next);
      setResolved(resolveTheme(next));
      setThemePreference(next);
    },
  };
}
