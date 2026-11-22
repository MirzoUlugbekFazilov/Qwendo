import Link from "next/link";

import { BookmarkIcon, CompassIcon, SparklesIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/nav-link";
import { getUser } from "@/lib/supabase/server";

export async function Navbar() {
  const user = await getUser();

  const metadata = (user?.user_metadata ?? {}) as Record<string, string | undefined>;
  const avatar = metadata.avatar_url ?? metadata.picture ?? null;
  const displayName = metadata.full_name ?? metadata.name ?? user?.email ?? "";
  const initial = displayName.trim().charAt(0).toUpperCase() || "Q";

  return (
    <header className="sticky top-0 z-40 border-b border-ink-850/80 bg-ink-950/70 backdrop-blur-xl">
      <nav
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-1 px-3 sm:gap-4 sm:px-6 lg:px-8"
        aria-label="Main"
      >
        <Logo />

        <div className="flex items-center gap-1 sm:gap-1.5">
          <NavLink href="/discover">
            <CompassIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Discover</span>
          </NavLink>

          {user ? (
            <>
              <NavLink href="/saved">
                <BookmarkIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Saved</span>
              </NavLink>
              <NavLink href="/picks">
                <SparklesIcon className="h-4 w-4 text-iris-400" />
                <span className="sr-only sm:not-sr-only">My picks</span>
              </NavLink>

              {user.app_metadata?.qwendo_admin === true && <NavLink href="/admin/discovery">Admin</NavLink>}

              <span
                className="ml-1 grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-iris-500 to-moss-500 text-sm font-bold text-ink-950 ring-1 ring-ink-700"
                title={displayName}
              >
                {avatar ? (
                  // Google avatars are served from googleusercontent.com.
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
                <button type="submit" className="btn btn-ghost h-10 px-3">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex h-10 whitespace-nowrap cursor-pointer items-center rounded-lg px-3 text-sm font-medium text-mist-300 transition-colors duration-200 hover:bg-ink-800 hover:text-mist-100"
              >
                Sign in
              </Link>
              <Link href="/login?mode=signup" className="btn btn-primary h-10 whitespace-nowrap px-2 sm:px-4">
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
