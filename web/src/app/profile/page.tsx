import Link from "next/link";
import { redirect } from "next/navigation";

import { EMPTY_LIST, request, safe } from "@/lib/api";
import {
  categories as categoryLabels,
  notifications as notificationLabels,
  priorityLabels,
  type DiscoveryProfile,
} from "@/lib/discovery-profile";
import { getAccessToken, getUser } from "@/lib/supabase/server";
import type { EventList } from "@/lib/types";

export const metadata = { title: "Your profile" };

type DiscoveryResponse = {
  profile: DiscoveryProfile | null;
  draft: { step: number; profile: DiscoveryProfile } | null;
};

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
      <p className="font-display text-2xl font-bold text-mist-100">{value}</p>
      <p className="text-xs text-mist-400">{label}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink-800 py-2.5 last:border-0">
      <dt className="text-sm text-mist-400">{label}</dt>
      <dd className="text-sm font-medium text-mist-100">{value}</dd>
    </div>
  );
}

export default async function ProfilePage() {
  const [user, token] = await Promise.all([getUser(), getAccessToken()]);
  if (!user || !token) redirect("/login?next=/profile");

  const [discovery, saved] = await Promise.all([
    safe(request<DiscoveryResponse>("/v1/me/discovery", { token }), {
      profile: null,
      draft: null,
    } as DiscoveryResponse),
    safe(request<EventList>("/v1/me/saved", { token }), EMPTY_LIST),
  ]);

  const profile = discovery.profile ?? discovery.draft?.profile ?? null;
  const confirmed = discovery.profile !== null;

  const metadata = (user.user_metadata ?? {}) as Record<string, string | undefined>;
  const avatar = metadata.avatar_url ?? metadata.picture ?? null;
  const displayName = metadata.full_name ?? metadata.name ?? user.email ?? "Member";
  const initial = displayName.trim().charAt(0).toUpperCase() || "Q";
  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : null;

  const mustSee = profile?.interests.filter((interest) => interest.priority === "must") ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
      <section className="surface flex flex-wrap items-center gap-5 rounded-card p-5 sm:p-7">
        <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-iris-500 to-moss-500 font-display text-2xl font-bold text-ink-950 ring-1 ring-ink-700">
          {avatar ? (
            // Google avatars are served from googleusercontent.com.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt=""
              width={80}
              height={80}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            initial
          )}
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="font-display text-3xl font-bold text-mist-100">{displayName}</h1>
          {user.email && <p className="truncate text-sm text-mist-400">{user.email}</p>}
          {memberSince && <p className="text-xs text-mist-500">Member since {memberSince}</p>}
        </div>

        <Link href="/settings" className="btn btn-primary h-10 px-4">
          Edit preferences
        </Link>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat value={profile?.interests.length ?? 0} label="Interests" />
        <Stat value={profile?.categories.length ?? 0} label="Categories" />
        <Stat value={saved.count} label="Saved events" />
      </div>

      <section className="surface space-y-4 rounded-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-mist-100">Discovery profile</h2>
            <p className="text-sm text-mist-400">
              {confirmed
                ? "What your picks are built from."
                : "Not finished yet — these answers aren’t personalising your picks."}
            </p>
          </div>
          <Link href="/settings" className="btn btn-ghost h-10 px-4">
            Change
          </Link>
        </div>

        {profile ? (
          <dl>
            <Row
              label="Categories"
              value={
                profile.categories.length
                  ? profile.categories.map((key) => categoryLabels[key] ?? key).join(", ")
                  : "None chosen"
              }
            />
            <Row label="City" value={profile.city || "Not set"} />
            <Row
              label="Travel radius"
              value={`${profile.radius} miles${profile.flexible_travel ? "" : " · firm"}`}
            />
            <Row label="Online events" value={profile.online ? "Included" : "Excluded"} />
            <Row
              label="Budget"
              value={`${
                profile.budget === null
                  ? "Any"
                  : profile.budget === 0
                    ? "Free events"
                    : `Up to £${profile.budget}`
              }${profile.budget_strict ? " · firm" : ""}`}
            />
            <Row
              label="Availability"
              value={`${profile.availability}${profile.availability_strict ? " · firm" : ""}`}
            />
            <Row
              label="Advance notice"
              value={`${profile.notice}${profile.notice_strict ? " · firm" : ""}`}
            />
            <Row
              label="Must not miss"
              value={
                mustSee.length
                  ? mustSee.map((interest) => interest.name).join(", ")
                  : "Nothing marked yet"
              }
            />
          </dl>
        ) : (
          <p className="text-sm text-mist-400">
            You haven’t set up your interests yet.{" "}
            <Link href="/onboarding" className="text-iris-200 underline">
              Start the guided setup
            </Link>
            .
          </p>
        )}
      </section>

      {profile && profile.interests.length > 0 && (
        <section className="surface space-y-4 rounded-card p-5 sm:p-7">
          <h2 className="font-display text-xl font-bold text-mist-100">Interests</h2>
          <ul className="flex flex-wrap gap-2">
            {profile.interests.map((interest) => (
              <li
                key={interest.name}
                className="inline-flex items-center gap-2 rounded-pill border border-ink-700 bg-ink-850 px-3.5 py-1.5 text-sm text-mist-200"
              >
                {interest.name}
                <span className="text-xs text-mist-500">{priorityLabels[interest.priority]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile && (
        <section className="surface space-y-3 rounded-card p-5 sm:p-7">
          <h2 className="font-display text-xl font-bold text-mist-100">Notifications</h2>
          <dl>
            {(Object.keys(notificationLabels) as (keyof typeof notificationLabels)[]).map((key) => (
              <Row
                key={key}
                label={notificationLabels[key]}
                value={profile.notifications[key] ? "On" : "Off"}
              />
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
