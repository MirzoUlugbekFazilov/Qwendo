import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2.5 ${className}`}
      aria-label="Qwendo home"
    >
      <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-iris-400 via-iris-500 to-moss-400 shadow-[0_8px_24px_-10px_rgb(124_58_237/0.9)] transition-transform duration-300 group-hover:scale-105">
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <circle cx="11" cy="11" r="6.4" fill="none" stroke="#0a0b0e" strokeWidth="2.3" />
          <path d="M15.6 15.6 20 20" stroke="#0a0b0e" strokeWidth="2.7" strokeLinecap="round" />
          <circle cx="11" cy="11" r="1.9" fill="#0a0b0e" />
        </svg>
      </span>
      <span className="font-display text-xl font-extrabold tracking-tight text-mist-100">
        Qwendo
      </span>
    </Link>
  );
}
