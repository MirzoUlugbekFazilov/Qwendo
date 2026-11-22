"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { ArrowRightIcon, GoogleMark } from "@/components/icons";
import { authDestination, signedInDestination } from "@/lib/auth-destination";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();

  const next = authDestination(params.get("next"));
  const [mode, setMode] = useState<"signin" | "signup">(
    params.get("mode") === "signup" ? "signup" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    params.get("error") === "auth"
      ? (params.get("reason") ??
        "That sign-in attempt didn't complete. Please try again.")
      : null,
  );
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  async function signInWithGoogle() {
    setGooglePending(true);
    setError(null);

    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Supabase sends the user back here with a code; the route handler
        // swaps it for a session cookie and decides where they land.
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });

    if (oauthError) {
      setError(
        oauthError.message.toLowerCase().includes("provider")
          ? "Google sign-in isn't enabled on this project yet."
          : oauthError.message,
      );
      setGooglePending(false);
    }
    // On success the browser navigates to Google — no state to reset.
  }

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setPending(true);
    setError(null);
    setStatus(null);

    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName || null },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
          },
        });
        if (signUpError) throw signUpError;

        if (!data.session) {
          setStatus("Check your inbox to confirm your email, then sign in.");
          return;
        }
        router.push("/onboarding");
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        router.push(await signedInDestination(supabase, data.user.id, next));
      }
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="surface w-full max-w-md rounded-card p-8">
      <h1 className="font-display text-2xl font-bold text-mist-100">
        {mode === "signup" ? "Create your feed" : "Welcome back"}
      </h1>
      <p className="mt-2 text-sm text-mist-400">
        {mode === "signup"
          ? "Set your interests to see matching events."
          : "Sign in to pick up your personalised feed."}
      </p>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={googlePending || pending}
        className="mt-7 inline-flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-ink-700 bg-ink-900 text-sm font-medium text-mist-100 transition-colors duration-200 hover:border-ink-600 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GoogleMark className="h-5 w-5" />
        {googlePending ? "Redirecting to Google…" : "Continue with Google"}
      </button>

      <div className="my-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-ink-800" />
        <span className="text-xs uppercase tracking-widest text-mist-500">or</span>
        <span className="h-px flex-1 bg-ink-800" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <div className="space-y-2">
            <label htmlFor="full-name" className="block text-sm font-medium text-mist-300">
              Name
            </label>
            <input
              id="full-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="h-12 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-mist-100 transition-colors duration-200 focus:border-moss-400 focus:outline-none"
            />
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-mist-300">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-mist-100 transition-colors duration-200 focus:border-moss-400 focus:outline-none"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-mist-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-12 w-full rounded-xl border border-ink-700 bg-ink-900 px-4 text-sm text-mist-100 transition-colors duration-200 focus:border-moss-400 focus:outline-none"
          />
          {mode === "signup" && (
            <p className="text-xs text-mist-500">At least 8 characters.</p>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
        {status && (
          <p role="status" className="rounded-lg bg-moss-400/10 px-3 py-2 text-sm text-moss-300">
            {status}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary h-12 w-full"
        >
          {pending ? "Just a moment…" : mode === "signup" ? "Create account" : "Sign in"}
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-mist-400">
        {mode === "signup" ? "Already have an account?" : "New to Qwendo?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setError(null);
            setStatus(null);
          }}
          className="cursor-pointer font-semibold text-moss-400 underline-offset-4 transition-colors duration-200 hover:text-moss-300 hover:underline"
        >
          {mode === "signup" ? "Sign in" : "Create one"}
        </button>
      </p>

      <p className="mt-4 text-center text-xs text-mist-500">
        <Link href="/discover" className="cursor-pointer transition-colors hover:text-mist-300">
          Browse without an account
        </Link>
      </p>
    </div>
  );
}
