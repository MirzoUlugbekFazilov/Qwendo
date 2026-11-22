"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { API_URL } from "@/lib/api";
import {
  availability as availabilityOptions,
  categories as categoryLabels,
  defaultRadarPreferences,
  emptyProfile,
  explicitInterest,
  formats as formatOptions,
  motivations as motivationOptions,
  notice as noticeOptions,
  notifications as notificationLabels,
  priorityLabels,
  type DiscoveryInterest,
  type DiscoveryProfile,
  type RadarPreferences,
} from "@/lib/discovery-profile";
import { createClient } from "@/lib/supabase/client";
import { CloseIcon } from "./icons";
import { Chip, Field, SettingsSection, Switch } from "./settings-controls";

const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
const BUDGET_OPTIONS = [0, 20, 50, 100] as const;
const MAX_MUST = 3;

/** Exactly the fields the API accepts — it rejects anything extra. */
function toPayload(profile: DiscoveryProfile) {
  const delivery = profile.radar_preferences ?? defaultRadarPreferences;
  return {
    categories: profile.categories,
    // Saving is a confirmation: anything the member added by hand is theirs.
    interests: profile.interests.map((interest) =>
      interest.source === "explicit" ? { ...interest, confirmed: true } : interest,
    ),
    text: profile.text,
    motivations: profile.motivations,
    formats: profile.formats,
    city: profile.city.trim(),
    radius: profile.radius,
    online: profile.online,
    flexible_travel: profile.flexible_travel,
    budget: profile.budget,
    budget_strict: profile.budget_strict,
    availability: profile.availability,
    availability_strict: profile.availability_strict,
    notice: profile.notice,
    notice_strict: profile.notice_strict,
    radar: profile.radar,
    radar_preferences: {
      frequency: delivery.frequency,
      quiet_start: delivery.quiet_start ?? null,
      quiet_end: delivery.quiet_end ?? null,
      timezone: delivery.timezone,
    },
    notifications: profile.notifications,
  };
}

export function DiscoverySettings({
  initialProfile,
  confirmed,
}: {
  initialProfile: DiscoveryProfile | null;
  confirmed: boolean;
}) {
  const router = useRouter();
  // A stored profile can predate any field added since, so it is merged onto
  // the empty one rather than trusted whole.
  const initial: DiscoveryProfile = useMemo(
    () => ({
      ...emptyProfile,
      ...initialProfile,
      notifications: { ...emptyProfile.notifications, ...initialProfile?.notifications },
      radar_preferences: initialProfile?.radar_preferences ?? defaultRadarPreferences,
    }),
    [initialProfile],
  );
  const [profile, setProfile] = useState<DiscoveryProfile>(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(toPayload(initial)));
  const [newInterest, setNewInterest] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  const delivery = profile.radar_preferences ?? defaultRadarPreferences;
  const payload = useMemo(() => toPayload(profile), [profile]);
  const dirty = JSON.stringify(payload) !== saved;

  const mustCount = profile.interests.filter((i) => i.priority === "must").length;
  const explicitCount = profile.interests.filter(
    (i) => i.source === "explicit" && i.name.trim(),
  ).length;
  const topicMissing = !profile.categories.length && !explicitCount;
  const cityMissing = !profile.city.trim();

  // The timezone list is large and browser-provided, so it is built once.
  const timezones = useMemo(
    () => [...new Set(["UTC", delivery.timezone, ...Intl.supportedValuesOf("timeZone")])],
    [delivery.timezone],
  );

  function update(patch: Partial<DiscoveryProfile>) {
    setProfile((current) => ({ ...current, ...patch }));
    setStatus("idle");
    setError("");
  }

  function changeDelivery(patch: Partial<RadarPreferences>) {
    update({ radar_preferences: { ...delivery, ...patch } });
  }

  function toggle<T extends string>(list: T[], value: T, limit: number) {
    if (list.includes(value)) return list.filter((item) => item !== value);
    return list.length >= limit ? list : [...list, value];
  }

  function changeInterest(name: string, patch: Partial<DiscoveryInterest>) {
    update({
      interests: profile.interests.map((interest) =>
        interest.name === name ? { ...interest, ...patch } : interest,
      ),
    });
  }

  function addInterest() {
    const name = newInterest.trim().slice(0, 160);
    if (!name) return;
    if (profile.interests.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
      setError(`“${name}” is already in your interests.`);
      return;
    }
    if (profile.interests.length >= 64) {
      setError("You can keep up to 64 interests.");
      return;
    }
    update({ interests: [...profile.interests, explicitInterest(name)] });
    setNewInterest("");
  }

  async function save() {
    if (topicMissing || cityMissing || status === "saving") return;
    setStatus("saving");
    setError("");
    try {
      const {
        data: { session },
      } = await createClient().auth.getSession();
      if (!session) {
        router.push("/login?next=/settings");
        return;
      }
      const response = await fetch(`${API_URL}/v1/me/discovery`, {
        method: "PUT",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(
          typeof detail?.detail === "string"
            ? detail.detail
            : "Your preferences couldn’t be saved. Please try again.",
        );
      }
      setSaved(JSON.stringify(payload));
      setStatus("saved");
      // Picks are rendered on the server from this profile.
      router.refresh();
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error ? caught.message : "Your preferences couldn’t be saved.");
    }
  }

  return (
    <div className="space-y-6">
      {!confirmed && (
        <p className="rounded-card border border-iris-400/40 bg-iris-500/10 px-4 py-3 text-sm text-iris-200">
          Your discovery profile isn’t finished yet. Fill in a city and at least one category or
          interest here, or{" "}
          <Link href="/onboarding" className="underline">
            run the guided setup
          </Link>
          .
        </p>
      )}

      <SettingsSection
        title="Categories"
        description="The broad areas Qwendo searches for you. Pick as many as you like."
      >
        <div className="flex flex-wrap gap-2">
          {Object.entries(categoryLabels).map(([key, label]) => (
            <Chip
              key={key}
              label={label}
              active={profile.categories.includes(key)}
              onToggle={() => update({ categories: toggle(profile.categories, key, 12) })}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Interests"
        description="Specific things you care about. Priority decides what reaches your Radar — you can mark up to three as must-not-miss."
      >
        <div className="space-y-3">
          {profile.interests.length === 0 && (
            <p className="text-sm text-mist-400">No interests yet. Add your first one below.</p>
          )}

          <ul className="space-y-2">
            {profile.interests.map((interest) => {
              const mustBlocked = interest.priority !== "must" && mustCount >= MAX_MUST;
              return (
                <li
                  key={interest.name}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-mist-100">
                      {interest.name}
                    </span>
                    <span className="text-xs text-mist-500">
                      {interest.source === "explicit"
                        ? "Added by you"
                        : interest.confirmed
                          ? "Suggested · confirmed"
                          : "Suggested · not confirmed"}
                    </span>
                  </span>

                  <select
                    aria-label={`Priority for ${interest.name}`}
                    className="field h-10 w-auto"
                    value={interest.priority}
                    onChange={(event) => {
                      const priority = event.target.value as DiscoveryInterest["priority"];
                      // The API only accepts confirmed interests at must-see priority.
                      changeInterest(interest.name, {
                        priority,
                        confirmed: priority === "must" ? true : interest.confirmed,
                      });
                    }}
                  >
                    {(Object.keys(priorityLabels) as (keyof typeof priorityLabels)[]).map((key) => (
                      <option key={key} value={key} disabled={key === "must" && mustBlocked}>
                        {priorityLabels[key]}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    aria-label={`Remove ${interest.name}`}
                    onClick={() =>
                      update({
                        interests: profile.interests.filter((i) => i.name !== interest.name),
                      })
                    }
                    className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg border border-ink-700 text-mist-400 transition-colors duration-200 hover:border-ink-500 hover:text-mist-100"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap gap-2">
            <input
              className="field h-11 flex-1 sm:max-w-sm"
              placeholder="Add an interest, e.g. indie film festivals"
              maxLength={160}
              value={newInterest}
              aria-label="Add an interest"
              onChange={(event) => setNewInterest(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addInterest();
              }}
            />
            <button
              type="button"
              className="btn btn-ghost h-11 px-4"
              onClick={addInterest}
              disabled={!newInterest.trim()}
            >
              Add
            </button>
          </div>

          <Field label="Anything else you’re into" htmlFor="interest-text">
            <textarea
              id="interest-text"
              className="field min-h-24"
              maxLength={4000}
              placeholder="Describe your taste in your own words."
              value={profile.text}
              onChange={(event) => update({ text: event.target.value })}
            />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Experiences"
        description="Why you go, and the kinds of events you enjoy."
      >
        <div className="space-y-5">
          <Field label="What brings you to an event?">
            <div className="flex flex-wrap gap-2">
              {motivationOptions.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  active={profile.motivations.includes(option)}
                  onToggle={() => update({ motivations: toggle(profile.motivations, option, 8) })}
                />
              ))}
            </div>
          </Field>

          <Field label="What kinds of experiences do you enjoy?">
            <div className="flex flex-wrap gap-2">
              {formatOptions.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  active={profile.formats.includes(option)}
                  onToggle={() => update({ formats: toggle(profile.formats, option, 10) })}
                />
              ))}
            </div>
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title="Location" description="Where Qwendo looks for events.">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" htmlFor="city">
              <input
                id="city"
                className="field h-11"
                autoComplete="address-level2"
                maxLength={120}
                placeholder="e.g. London"
                value={profile.city}
                onChange={(event) => update({ city: event.target.value })}
              />
            </Field>

            <Field label="Travel radius" htmlFor="radius">
              <select
                id="radius"
                className="field h-11"
                value={profile.radius}
                onChange={(event) => update({ radius: Number(event.target.value) })}
              >
                {RADIUS_OPTIONS.map((miles) => (
                  <option key={miles} value={miles}>
                    {miles} miles
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="divide-y divide-ink-800">
            <Switch
              label="Include online events"
              checked={profile.online}
              onChange={(online) => update({ online })}
            />
            <Switch
              label="Only show in-person events within my radius"
              description="Off means the occasional trip worth making can still appear."
              checked={!profile.flexible_travel}
              onChange={(strict) => update({ flexible_travel: !strict })}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Budget and timing"
        description="Mark a preference as a firm limit and nothing outside it will be shown."
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Ticket budget" htmlFor="budget">
              <select
                id="budget"
                className="field h-11"
                value={profile.budget ?? ""}
                onChange={(event) =>
                  update({ budget: event.target.value === "" ? null : Number(event.target.value) })
                }
              >
                <option value="">Any budget</option>
                {BUDGET_OPTIONS.map((amount) => (
                  <option key={amount} value={amount}>
                    {amount ? `Up to £${amount}` : "Free events"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Availability" htmlFor="availability">
              <select
                id="availability"
                className="field h-11"
                value={profile.availability}
                onChange={(event) => update({ availability: event.target.value })}
              >
                {availabilityOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </Field>

            <Field label="Advance notice" htmlFor="notice">
              <select
                id="notice"
                className="field h-11"
                value={profile.notice}
                onChange={(event) => update({ notice: event.target.value })}
              >
                {noticeOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="divide-y divide-ink-800">
            <Switch
              label="Only show events within my budget"
              checked={profile.budget_strict}
              onChange={(budget_strict) => update({ budget_strict })}
            />
            <Switch
              label="Only show events during the times I’m free"
              checked={profile.availability_strict}
              onChange={(availability_strict) => update({ availability_strict })}
            />
            <Switch
              label="Only show events with this much notice"
              checked={profile.notice_strict}
              onChange={(notice_strict) => update({ notice_strict })}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Radar"
        description="The thing you’d hate to miss, and how its alerts reach you."
      >
        <div className="space-y-5">
          <Field label="What would you hate to miss?" htmlFor="radar">
            <textarea
              id="radar"
              className="field min-h-24"
              maxLength={4000}
              placeholder="Describe a dream event."
              value={profile.radar}
              onChange={(event) => update({ radar: event.target.value })}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Delivery frequency" htmlFor="frequency">
              <select
                id="frequency"
                className="field h-11"
                value={delivery.frequency}
                onChange={(event) =>
                  changeDelivery({ frequency: event.target.value as RadarPreferences["frequency"] })
                }
              >
                <option value="immediate">Immediate</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </Field>

            <Field label="Time zone" htmlFor="timezone">
              <select
                id="timezone"
                className="field h-11"
                value={delivery.timezone}
                onChange={(event) => changeDelivery({ timezone: event.target.value })}
              >
                {timezones.map((zone) => (
                  <option key={zone}>{zone}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="divide-y divide-ink-800">
            <Switch
              label="Use quiet hours"
              description="Alerts wait until quiet hours are over."
              checked={!!delivery.quiet_start}
              onChange={(enabled) =>
                changeDelivery(
                  enabled
                    ? { quiet_start: "22:00", quiet_end: "07:00" }
                    : { quiet_start: null, quiet_end: null },
                )
              }
            />
          </div>

          {delivery.quiet_start && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Quiet hours start" htmlFor="quiet-start">
                <input
                  id="quiet-start"
                  type="time"
                  className="field h-11"
                  value={delivery.quiet_start ?? ""}
                  onChange={(event) => {
                    if (event.target.value) changeDelivery({ quiet_start: event.target.value });
                  }}
                />
              </Field>
              <Field label="Quiet hours end" htmlFor="quiet-end">
                <input
                  id="quiet-end"
                  type="time"
                  className="field h-11"
                  value={delivery.quiet_end ?? ""}
                  onChange={(event) => {
                    if (event.target.value) changeDelivery({ quiet_end: event.target.value });
                  }}
                />
              </Field>
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="Notifications" description="These updates appear inside Qwendo.">
        <div className="divide-y divide-ink-800">
          {(Object.keys(notificationLabels) as (keyof typeof notificationLabels)[]).map((key) => (
            <Switch
              key={key}
              label={notificationLabels[key]}
              checked={profile.notifications[key]}
              onChange={(value) =>
                update({ notifications: { ...profile.notifications, [key]: value } })
              }
            />
          ))}
        </div>
      </SettingsSection>

      {/* Save bar follows the page: on a form this long, a button only at the
          bottom means scrolling back to find out whether anything happened. */}
      <div className="sticky bottom-4 z-30">
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-card px-4 py-3">
          <p
            role={error ? "alert" : "status"}
            className={`text-sm ${error ? "text-mist-100" : "text-mist-400"}`}
          >
            {error ||
              (topicMissing
                ? "Choose a category or add an interest to save."
                : cityMissing
                  ? "Enter your city to save."
                  : status === "saving"
                    ? "Saving…"
                    : status === "saved"
                      ? "Preferences saved."
                      : dirty
                        ? "You have unsaved changes."
                        : "Everything is saved.")}
          </p>
          <button
            type="button"
            className="btn btn-primary h-10 px-5"
            onClick={save}
            disabled={!dirty || topicMissing || cityMissing || status === "saving"}
          >
            {status === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
