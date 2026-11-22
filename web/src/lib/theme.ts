/**
 * Theme preference: light, dark, or follow the operating system.
 *
 * The resolved theme lands on `<html data-theme="…">`, which every colour token
 * in globals.css keys off. Nothing else in the app has to know about themes.
 *
 * The preference lives in localStorage rather than on the server: it is a
 * per-device choice, and reading it inline (see `themeInitScript`) is the only
 * way to paint the first frame in the right theme with no flash.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "qwendo-theme";

/** Fired on `window` when the preference changes, so every mounted control agrees. */
export const THEME_EVENT = "qwendo:theme";

export const THEME_OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Bright surfaces, dark text." },
  { value: "dark", label: "Dark", hint: "The original Qwendo look." },
  { value: "system", label: "System", hint: "Match your device setting." },
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Light, not "system".
 *
 * Qwendo's default look is the light one, and a fixed default means every
 * member sees the same product until they say otherwise. Dark and "System"
 * are one click away in Settings.
 */
export const DEFAULT_THEME: ThemePreference = "light";

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Storage can be blocked (private mode, embedded contexts) — fall back.
    return DEFAULT_THEME;
  }
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  // Keeps native controls, scrollbars and form widgets in the same theme.
  root.style.colorScheme = resolved;
  // Mobile browser chrome should match the page it frames.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "light" ? "#ffffff" : "#0a0b0e");
}

export function setThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // A device that cannot persist the choice still gets it for this session.
  }
  applyTheme(resolveTheme(preference));
  window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_EVENT, { detail: preference }));
}

/**
 * Runs before first paint, in the document head.
 *
 * Deliberately terse and dependency-free: it is inlined into every HTML
 * response, and anything it throws must never break the page.
 */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark"&&p!=="system")p="light";var t=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;var c=t==="light"?"#ffffff":"#0a0b0e";var s=function(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",c);};s();document.addEventListener("DOMContentLoaded",s);}catch(e){}})();`;
