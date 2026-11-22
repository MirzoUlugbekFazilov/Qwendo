import type { SupabaseClient } from "@supabase/supabase-js";

/** Only navigate to a path on this site after authentication. */
export function authDestination(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/picks";
  return value;
}

/**
 * Where a signed-in member belongs.
 *
 * Qwendo ranks against a confirmed discovery profile, so the presence of that
 * profile — not the older `profiles.onboarded` flag — decides whether someone
 * is ready for their feed. The two disagree for every member who onboarded
 * before discovery profiles existed: `onboarded` is true while the profile row
 * is absent. Entry points that keyed on the flag sent those members to /picks,
 * while the landing page keyed on the profile and kept serving them the
 * signed-out marketing pitch. One rule here keeps them from disagreeing again.
 *
 * Members without a profile are not sent back to square one: `/v1/me/discovery`
 * seeds the onboarding draft from the interests they already picked, so
 * onboarding is a confirmation rather than a re-entry, and it ends on /picks.
 */
export async function signedInDestination(
  supabase: SupabaseClient,
  userId: string,
  next: string | null = null,
): Promise<string> {
  const { data, error } = await supabase
    .from("user_discovery_profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  // A failed read must not push a set-up member back through onboarding. The
  // feed is the safer guess: it falls back to legacy interests on its own.
  if (error) return authDestination(next);
  return data ? authDestination(next) : "/onboarding";
}
