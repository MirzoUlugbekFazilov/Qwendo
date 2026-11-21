"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigation item that marks the current section.
 *
 * Without this there was no indication of where you are in the app — and
 * `aria-current` is what tells a screen reader the same thing.
 */
export function NavLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-200 ${
        active
          ? "bg-ink-800 text-mist-100"
          : "text-mist-300 hover:bg-ink-800/70 hover:text-mist-100"
      } ${className}`}
    >
      {children}
    </Link>
  );
}
