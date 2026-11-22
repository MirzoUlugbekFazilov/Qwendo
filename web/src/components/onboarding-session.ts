"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { emptyProfile, type DiscoveryProfile } from "@/lib/discovery-profile";

type Draft = { step: number; profile: DiscoveryProfile };
type Loaded = { draft: Draft | null; profile: DiscoveryProfile | null };

export function useDiscoverySession() {
  const router = useRouter();
  const userId = useRef<string | null>(null);
  const request = useCallback(async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const { data: { session } } = await createClient().auth.getSession();
    if (!session || (userId.current && userId.current !== session.user.id)) {
      router.replace("/login?next=/onboarding");
      throw new Error("Please sign in again.");
    }
    userId.current = session.user.id;
    const response = await fetch(API_URL + "/v1/me/discovery" + path, {
      method, cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Discovery request failed (" + response.status + ").");
    if (method === "PUT") return undefined as T;
    return response.json();
  }, [router]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef<Draft | null>(null);
  const pending = useRef<Draft | null>(null);
  const queue = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const locked = useRef(false);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    request<Loaded>("").then(({ draft: saved, profile }) => {
      if (!active) return;
      const value = saved?.profile ?? profile;
      const initial = {
        step: Math.min(7, Math.max(1, saved?.step || 1)),
        profile: { ...emptyProfile, ...value, notifications: { ...emptyProfile.notifications, ...value?.notifications } },
      };
      latest.current = initial;
      setDraft(initial);
    }).catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [attempt, request]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const snapshot = pending.current;
    if (!snapshot) return;
    pending.current = null;
    queue.current = queue.current.then(async () => {
      if (snapshot !== latest.current || locked.current) return;
      try {
        await request("/draft", "PUT", snapshot);
        if (latest.current === snapshot) setStatus("Draft saved");
      } catch {
        if (latest.current === snapshot) {
          pending.current = snapshot;
          setStatus("Draft could not be saved");
        }
      }
    });
  }, [request]);

  useEffect(() => {
    const onHidden = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", onHidden);
    return () => { document.removeEventListener("visibilitychange", onHidden); flush(); };
  }, [flush]);

  function update(profile: Partial<DiscoveryProfile>, step?: number) {
    const previous = latest.current;
    if (!previous || locked.current) return;
    const snapshot = { step: step ?? previous.step, profile: { ...previous.profile, ...profile } };
    latest.current = pending.current = snapshot;
    setDraft(snapshot);
    setStatus("Saving draft…");
    setSaveFailed(false);
    clearTimeout(timer.current);
    if (step !== undefined) flush();
    else timer.current = setTimeout(flush, 450);
  }

  async function finish() {
    if (!latest.current || locked.current) return;
    locked.current = true;
    clearTimeout(timer.current);
    pending.current = null;
    setFinishing(true);
    setSaveFailed(false);
    try {
      await queue.current;
      const profile = latest.current.profile;
      await request("", "PUT", {
        ...profile,
        interests: profile.interests.map(item => item.source === "explicit" ? { ...item, confirmed: true } : item),
      });
      router.push("/picks");
    } catch {
      locked.current = false;
      setFinishing(false);
      setSaveFailed(true);
      pending.current = latest.current;
      flush();
    }
  }

  return { draft, update, request, loadFailed, reload: () => setAttempt(n => n + 1),
    status, retryDraft: flush, finish, finishing, saveFailed };
}
