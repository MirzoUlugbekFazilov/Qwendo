"use client";

import { startTransition, useActionState, type ReactNode } from "react";

export function DiscoveryActionForm({ action, children, label }: {
  action: (state: string, data: FormData) => Promise<string>;
  children: ReactNode;
  label: string;
}) {
  const [message, submit, pending] = useActionState(action, "");
  return <form onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    startTransition(() => submit(values));
  }} className="surface grid gap-4 rounded-card p-5 [&_input:not([type=checkbox])]:w-full [&_select]:w-full [&_textarea]:w-full [&_input]:rounded [&_select]:rounded [&_textarea]:rounded [&_input]:bg-ink-900 [&_textarea]:bg-ink-900 [&_select]:bg-ink-900 [&_input]:p-2 [&_textarea]:p-2 [&_select]:p-2">
    {children}
    <button className="btn btn-primary justify-self-start" disabled={pending}>{pending ? "Sending…" : label}</button>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
