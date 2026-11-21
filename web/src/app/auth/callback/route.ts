import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / email-confirmation landing point.
 *
 * Supabase redirects here with `?code=…`, which we exchange for a session
 * cookie. New users (no interests yet) go to onboarding; everyone else
 * continues to wherever they were headed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/discover";

  // The provider itself can reject the attempt (user cancelled, app not
  // configured, consent withdrawn) — it reports that here, not via `code`.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    const back = new URL("/login", origin);
    back.searchParams.set("error", "auth");
    back.searchParams.set("reason", providerError.slice(0, 160));
    return NextResponse.redirect(back);
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth", origin));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?error=auth", origin));
  }

  // Straight to onboarding until there's a taste profile to recommend against.
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarded")
    .eq("id", data.user.id)
    .maybeSingle();

  const destination = profile?.onboarded ? next : "/onboarding";
  return NextResponse.redirect(new URL(destination, origin));
}
