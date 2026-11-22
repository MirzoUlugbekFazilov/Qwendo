"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Account menu behind the avatar.
 *
 * The avatar used to be a decorative `<span>` with a separate "Sign out"
 * button eating navbar width. Making it the one account affordance follows
 * the convention everyone already knows, and keeps profile, settings and
 * sign-out in a single predictable place.
 *
 * Keyboard behaviour is the WAI-ARIA menu button pattern: Enter/Space/Down
 * opens and focuses the first item, Up opens on the last, arrows move, Escape
 * closes and returns focus to the trigger.
 */
export function UserMenu({
  name,
  email,
  avatar,
  isAdmin = false,
}: {
  name: string;
  email: string;
  avatar: string | null;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const pathname = usePathname();

  const initial = name.trim().charAt(0).toUpperCase() || "Q";

  // A menu that survives navigation would hang over the page it opened.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const items = () =>
    Array.from(panel.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? []);

  function openWith(edge: "first" | "last") {
    setOpen(true);
    // The panel only exists after the state flush, so focus on the next frame.
    requestAnimationFrame(() => {
      const found = items();
      (edge === "first" ? found[0] : found[found.length - 1])?.focus();
    });
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWith("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openWith("last");
    }
  }

  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const found = items();
    if (!found.length) return;
    const index = found.indexOf(document.activeElement as HTMLElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      found[(index + 1) % found.length].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      found[(index - 1 + found.length) % found.length].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      found[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      found[found.length - 1].focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  const item =
    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-mist-200 transition-colors duration-150 hover:bg-ink-800 hover:text-mist-100 focus-visible:bg-ink-800 focus-visible:text-mist-100";

  return (
    <div className="relative" ref={container}>
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? setOpen(false) : openWith("first"))}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={`ml-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-gradient-to-br from-iris-500 to-moss-500 text-sm font-bold text-ink-950 ring-1 transition-shadow duration-200 ${
          open ? "ring-2 ring-iris-400" : "ring-ink-700 hover:ring-ink-500"
        }`}
      >
        <span className="sr-only">Account menu for {name}</span>
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
          <span aria-hidden="true">{initial}</span>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          ref={panel}
          role="menu"
          aria-label="Account"
          onKeyDown={onPanelKeyDown}
          className="elevated absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 origin-top-right animate-fade overflow-hidden rounded-card border border-ink-700 bg-ink-875 p-1.5"
        >
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-iris-500 to-moss-500 text-sm font-bold text-ink-950 ring-1 ring-ink-700">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatar}
                  alt=""
                  width={40}
                  height={40}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span aria-hidden="true">{initial}</span>
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-mist-100">{name}</span>
              <span className="block truncate text-xs text-mist-400">{email}</span>
            </span>
          </div>

          <hr className="my-1.5 border-ink-700" />

          <Link href="/profile" role="menuitem" className={item} onClick={() => setOpen(false)}>
            View profile
          </Link>
          <Link href="/settings" role="menuitem" className={item} onClick={() => setOpen(false)}>
            Settings
          </Link>
          {isAdmin && (
            <Link
              href="/admin/discovery"
              role="menuitem"
              className={item}
              onClick={() => setOpen(false)}
            >
              Admin
            </Link>
          )}

          <hr className="my-1.5 border-ink-700" />

          {/* Sign-out clears the session cookie server-side, so it must be a POST. */}
          <form action="/auth/signout" method="post" role="none">
            <button type="submit" role="menuitem" className={item}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
