import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/onboarding-form";
import { api, safe } from "@/lib/api";
import { getAccessToken } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";

export const metadata: Metadata = {
  title: "Your interests",
  description: "Tell Qwendo what you care about and we'll watch every marketplace for it.",
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const token = await getAccessToken();
  if (!token) redirect("/login?next=/onboarding");

  const [interests, me] = await Promise.all([
    safe(api.interests(), []),
    safe<Me | null>(api.me(token), null),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10 space-y-3">
        <h1 className="font-display text-3xl font-bold text-mist-100 sm:text-4xl">
          {me?.profile.onboarded ? "Tune your feed" : "Let's build your feed"}
        </h1>
        <p className="max-w-2xl text-mist-400">
          Everything here feeds one vector that we match against every event we ingest. The more
          honest you are, the better the feed gets.
        </p>
      </header>

      {interests.length === 0 ? (
        <div className="surface rounded-card p-8 text-sm text-mist-400">
          The interest taxonomy couldn&apos;t be loaded — check that the API is running on{" "}
          <code className="text-amber-300">{process.env.NEXT_PUBLIC_API_URL}</code>.
        </div>
      ) : (
        <OnboardingForm interests={interests} me={me} />
      )}
    </div>
  );
}
