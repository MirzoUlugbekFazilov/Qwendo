import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Same forwarded-host caveat as the auth callback: behind Vercel's proxy,
  // request.url may be the internal deployment host.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin =
    forwardedHost && process.env.NODE_ENV !== "development"
      ? `${request.headers.get("x-forwarded-proto") ?? "https"}://${forwardedHost}`
      : new URL(request.url).origin;

  return NextResponse.redirect(new URL("/", origin), { status: 303 });
}
