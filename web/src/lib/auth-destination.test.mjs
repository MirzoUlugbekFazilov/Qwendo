import assert from "node:assert/strict";
import test from "node:test";

import { signedInDestination } from "./auth-destination.ts";

/** Minimal stand-in for the query chain `signedInDestination` builds. */
function supabaseReturning(result) {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return chain;
}

const withProfile = supabaseReturning({ data: { user_id: "u1" }, error: null });
const withoutProfile = supabaseReturning({ data: null, error: null });
const unreadable = supabaseReturning({ data: null, error: { message: "network" } });

test("a confirmed profile sends the member to their feed", async () => {
  assert.equal(await signedInDestination(withProfile, "u1"), "/picks");
});

test("a confirmed profile honours where the member was headed", async () => {
  assert.equal(await signedInDestination(withProfile, "u1", "/saved"), "/saved");
});

test("no profile means onboarding, whatever the requested destination", async () => {
  assert.equal(await signedInDestination(withoutProfile, "u1"), "/onboarding");
  assert.equal(await signedInDestination(withoutProfile, "u1", "/saved"), "/onboarding");
});

test("an off-site destination is refused rather than followed", async () => {
  assert.equal(await signedInDestination(withProfile, "u1", "//evil.example"), "/picks");
  assert.equal(await signedInDestination(withProfile, "u1", "https://evil.example"), "/picks");
});

test("a failed read sends the member to the feed, not back through onboarding", async () => {
  // The feed degrades to legacy interests on its own; onboarding would be a
  // pointless detour for someone who has already completed it.
  assert.equal(await signedInDestination(unreadable, "u1"), "/picks");
  assert.equal(await signedInDestination(unreadable, "u1", "/saved"), "/saved");
});
