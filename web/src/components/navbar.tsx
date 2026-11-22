import Link from "next/link";

import { BookmarkIcon, CompassIcon, SparklesIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { NavLink } from "@/components/nav-link";
import { UserMenu } from "@/components/user-menu";
import { getUser } from "@/lib/supabase/server";

export async function Navbar() {
  const user = await getUser();

  const metadata = (user?.user_metadata ?? {}) as Record<string, string | undefined>;
  const avatar = metadata.avatar_url ?? metadata.picture ?? null;
  const displayName = metadata.full_name ?? metadata.name ?? user?.email ?? "";

  return (
    <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/70 backdrop-blur-xl">
      <nav
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-1 px-3 sm:gap-4 sm:px-6 lg:px-8"
        aria-label="Main"
      >
        <Logo />

        <div className="flex items-center gap-1 sm:gap-1.5">
          {user ? (
            <>
              {/* Personalised first: it is where a signed-in member starts. */}
              <NavLink href="/picks">
                <SparklesIcon className="h-4 w-4 text-iris-400" />
                <span className="sr-only sm:not-sr-only">For You</span>
              </NavLink>
              <NavLink href="/discover">
                <CompassIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Discover</span>
              </NavLink>
              <NavLink href="/saved">
                <BookmarkIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Saved</span>
              </NavLink>

              <UserMenu
                name={displayName}
                email={user.email ?? ""}
                avatar={avatar}
                isAdmin={user.app_metadata?.qwendo_admin === true}
              />
            </>
          ) : (
            <>
              <NavLink href="/discover">
                <CompassIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Discover</span>
              </NavLink>
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
