import Link from "next/link";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2.5 ${className}`}
      aria-label="Qwendo home"
    >
      <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-amber-400 transition-transform duration-200 group-hover:rotate-6">
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="#07080a" strokeWidth="2.2" />
          <path d="M15.5 15.5 20 20" stroke="#07080a" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="11" cy="11" r="2" fill="#07080a" />
        </svg>
      </span>
      <span className="font-display text-xl font-bold tracking-tight text-mist-100">Qwendo</span>
    </Link>
  );
}
