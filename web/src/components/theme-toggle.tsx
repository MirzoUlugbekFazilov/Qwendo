"use client";

import { THEME_OPTIONS, type ThemePreference } from "@/lib/theme";
import { CheckIcon } from "./icons";
import { useTheme } from "./use-theme";

/** Miniature of a Qwendo page, drawn in fixed colours so each card previews itself. */
function Preview({ value }: { value: ThemePreference }) {
  const palettes = {
    light: { page: "#ffffff", bar: "#eef1f5", line: "#c4ccd8", accent: "#7c3aed" },
    dark: { page: "#0d0f13", bar: "#1f242c", line: "#39414d", accent: "#a78bfa" },
  } as const;

  const halves: ThemePreference[] = value === "system" ? ["light", "dark"] : [value];

  return (
    <span aria-hidden="true" className="flex h-16 w-full overflow-hidden rounded-lg border border-ink-700">
      {halves.map((half) => {
        const colors = palettes[half as "light" | "dark"];
        return (
          <span
            key={half}
            className="flex min-w-0 flex-1 flex-col gap-1.5 p-2"
            style={{ backgroundColor: colors.page }}
          >
            <span className="h-2 w-full rounded-sm" style={{ backgroundColor: colors.bar }} />
            <span className="h-1.5 w-3/4 rounded-sm" style={{ backgroundColor: colors.accent }} />
            <span className="h-1.5 w-full rounded-sm" style={{ backgroundColor: colors.line }} />
            <span className="h-1.5 w-2/3 rounded-sm" style={{ backgroundColor: colors.line }} />
          </span>
        );
      })}
    </span>
  );
}

export function ThemeToggle() {
  const { preference, ready, choose } = useTheme();

  return (
    <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
      {THEME_OPTIONS.map((option) => {
        const selected = ready && preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => choose(option.value)}
            className={`flex cursor-pointer flex-col gap-3 rounded-card border p-3 text-left transition-colors duration-200 ${
              selected
                ? "border-iris-400 bg-iris-500/10"
                : "border-ink-700 bg-ink-850 hover:border-ink-500 hover:bg-ink-800"
            }`}
          >
            <Preview value={option.value} />
            <span className="flex items-center justify-between gap-2">
              <span className={`text-sm font-semibold ${selected ? "text-iris-200" : "text-mist-100"}`}>
                {option.label}
              </span>
              {selected && <CheckIcon className="h-4 w-4 text-iris-200" />}
            </span>
            <span className="text-xs text-mist-400">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
