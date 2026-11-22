import { NextResponse, type NextRequest } from "next/server";

import { signedInDestination } from "@/lib/auth-destination";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolve the public origin of this request.
 *
 * Behind Vercel's proxy, `request.url` can carry the internal deployment host
 * (`qwendo-5xkp2anhd-….vercel.app`) rather than the canonical domain. Redirecting
 * to that would drop users on a deployment URL — and on a host that isn't in
 * Supabase's redirect allow-list. The forwarded headers hold the real one.
 */
function publicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost || process.env.NODE_ENV === "development") {
    return new URL(request.url).origin;
  }
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${forwardedHost}`;
}

/**
 * OAuth / email-confirmation landing point.
 *
 * Supabase redirects here with `?code=…`, which we exchange for a session
 * cookie. New users (no interests yet) go to onboarding; everyone else
 * continues to wherever they were headed.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

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
    const back = new URL("/login", origin);
    back.searchParams.set("error", "auth");
    if (error?.message) back.searchParams.set("reason", error.message.slice(0, 160));
    return NextResponse.redirect(back);
  }

  // Straight to onboarding until there's a confirmed profile to rank against.
  const destination = await signedInDestination(supabase, data.user.id, next);
  return NextResponse.redirect(new URL(destination, origin));
}
