import "server-only";
import { API_URL, ApiError } from "@/lib/api";
import type { EventList } from "@/lib/types";
import type { PicksResponse } from "./picks-model";

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_URL}/v1/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new ApiError(res.status, "Could not load personalised events");
  return res.json();
}

export const getPicks = (token: string) => get<PicksResponse>("picks", token);
export const getRelevance = (token: string, eventId: string) =>
  get<{ reason: string; matched_interest: string | null } | null>(`relevance/${encodeURIComponent(eventId)}`, token);
export const getDiscovery = (token: string) =>
  get<Pick<PicksResponse, "profile">>("discovery", token);
export const getPickState = (token: string, state: "saved" | "going") =>
  get<EventList>(`saved?state=${state}&limit=100`, token);
