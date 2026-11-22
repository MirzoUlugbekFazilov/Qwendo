import Link from "next/link";
import { redirect } from "next/navigation";

import { DiscoverySettings } from "@/components/discovery-settings";
import { SettingsAppearance } from "@/components/settings-appearance";
import { request, safe } from "@/lib/api";
import type { DiscoveryProfile } from "@/lib/discovery-profile";
import { getAccessToken, getUser } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };

type DiscoveryResponse = {
  profile: DiscoveryProfile | null;
  draft: { step: number; profile: DiscoveryProfile } | null;
};

export default async function SettingsPage() {
  const [user, token] = await Promise.all([getUser(), getAccessToken()]);
  if (!user || !token) redirect("/login?next=/settings");

  // Rendered on the server so the form opens filled in, not empty then jumping.
  const discovery = await safe(
    request<DiscoveryResponse>("/v1/me/discovery", { token }),
    { profile: null, draft: null } as DiscoveryResponse,
  );
  // An unfinished wizard still holds the member's answers — show those rather
  // than a blank form they would have to fill in twice.
  const profile = discovery.profile ?? discovery.draft?.profile ?? null;

  const metadata = (user.user_metadata ?? {}) as Record<string, string | undefined>;
  const displayName = metadata.full_name ?? metadata.name ?? user.email ?? "";

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="font-display text-4xl font-bold text-mist-100">Settings</h1>
        <p className="text-sm text-mist-400">
          Signed in as {displayName}
          {user.email && displayName !== user.email ? ` · ${user.email}` : ""}
        </p>
      </header>

      <SettingsAppearance />

      <DiscoverySettings initialProfile={profile} confirmed={discovery.profile !== null} />

      <section className="surface rounded-card p-5 sm:p-7">
        <h2 className="font-display text-xl font-bold text-mist-100">Account</h2>
        <p className="mt-1 text-sm text-mist-400">
          Your name and picture come from the account you signed in with.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/profile" className="btn btn-ghost h-10 px-4">
            View profile
          </Link>
          <Link href="/onboarding" className="btn btn-ghost h-10 px-4">
            Re-run guided setup
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="btn btn-ghost h-10 px-4">
              Sign out
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
