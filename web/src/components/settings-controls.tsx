"use client";

import { CheckIcon } from "./icons";

/** Card used for every settings section, so the page reads as one list. */
export function SettingsSection({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="surface rounded-card p-5 sm:p-7">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-mist-100">{title}</h2>
          {description && <p className="max-w-prose text-sm text-mist-400">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-mist-200">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-mist-500">{hint}</p>}
    </div>
  );
}

/** Pill chip used for categories — the same visual language as Discover's filters. */
export function Chip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-pill border px-3.5 text-sm transition-colors duration-200 ${
        active
          ? "border-iris-400/70 bg-iris-500/15 font-medium text-iris-200"
          : "border-ink-700 bg-ink-850 text-mist-300 hover:border-ink-500 hover:bg-ink-800 hover:text-mist-100"
      }`}
    >
      {active && <CheckIcon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

/** Accessible switch: a real button with `role="switch"`, not a styled checkbox. */
export function Switch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-start justify-between gap-4 rounded-xl px-1 py-2.5 text-left transition-colors duration-200 hover:bg-ink-850/60"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-mist-200">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-mist-500">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-pill border p-0.5 transition-colors duration-200 ${
          checked ? "border-iris-400 bg-iris-500" : "border-ink-600 bg-ink-800"
        }`}
      >
        <span
          className={`h-4.5 w-4.5 rounded-full bg-mist-100 transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
          style={{ height: "1.125rem", width: "1.125rem" }}
        />
      </span>
    </button>
  );
}
