import Link from "next/link";

import { BookmarkIcon, CompassIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { getUser } from "@/lib/supabase/server";

export async function Navbar() {
  const user = await getUser();

  const metadata = (user?.user_metadata ?? {}) as Record<string, string | undefined>;
  const avatar = metadata.avatar_url ?? metadata.picture ?? null;
  const displayName = metadata.full_name ?? metadata.name ?? user?.email ?? "";
  const initial = displayName.trim().charAt(0).toUpperCase() || "Q";

  return (
    <header className="sticky top-0 z-40 border-b border-ink-850 bg-ink-950/80 backdrop-blur-xl">
      <nav
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
        aria-label="Main"
      >
        <Logo />

        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/discover"
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-mist-300 transition-colors duration-200 hover:bg-ink-850 hover:text-mist-100"
          >
            <CompassIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Discover</span>
          </Link>

          {user ? (
            <>
              <Link
                href="/saved"
                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-mist-300 transition-colors duration-200 hover:bg-ink-850 hover:text-mist-100"
              >
                <BookmarkIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Saved</span>
              </Link>
              <Link
                href="/onboarding"
                className="hidden h-10 cursor-pointer items-center rounded-lg px-3 text-sm font-medium text-mist-300 transition-colors duration-200 hover:bg-ink-850 hover:text-mist-100 sm:inline-flex"
              >
                Interests
              </Link>
              <span
                className="ml-1 grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-ink-700 bg-ink-850 text-sm font-semibold text-mist-300"
                title={displayName}
              >
                {avatar ? (
                  // Google avatars come from googleusercontent.com; a plain img
                  // avoids pinning yet another remote host in next.config.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatar}
                    alt=""
                    width={36}
                    height={36}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initial
                )}
              </span>

              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-ink-700 px-3 text-sm font-medium text-mist-300 transition-colors duration-200 hover:border-ink-600 hover:text-mist-100"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex h-10 cursor-pointer items-center rounded-lg px-3 text-sm font-medium text-mist-300 transition-colors duration-200 hover:bg-ink-850 hover:text-mist-100"
              >
                Sign in
              </Link>
              <Link
                href="/login?mode=signup"
                className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-amber-400 px-4 text-sm font-semibold text-ink-950 transition-colors duration-200 hover:bg-amber-300"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
