import type { EventList, Interest, Me, QwendoEvent } from "@/lib/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type RequestOptions = {
  token?: string | null;
  method?: string;
  body?: unknown;
  /** Seconds to cache. Omit for personalised responses. */
  revalidate?: number;
  signal?: AbortSignal;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, method = "GET", body, revalidate, signal } = options;

  const response = await fetch(`${API_URL}${path}`, {
    method,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(revalidate === undefined ? { cache: "no-store" as const } : { next: { revalidate } }),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = await response.json();
      detail = payload?.detail ?? detail;
    } catch {
      // response had no JSON body
    }
    throw new ApiError(response.status, typeof detail === "string" ? detail : "Request failed");
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Server components call this: a dead backend should degrade, not crash the page. */
export async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[qwendo] API request failed:", (error as Error).message);
    }
    return fallback;
  }
}

export const EMPTY_LIST: EventList = {
  items: [],
  count: 0,
  limit: 0,
  offset: 0,
  personalized: false,
  fallback: null,
};

export type EventQuery = {
  q?: string;
  city?: string;
  categories?: string[];
  sources?: string[];
  free_only?: boolean;
  starts_after?: string;
  starts_before?: string;
  limit?: number;
  offset?: number;
};

function toSearchParams(query: EventQuery = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => params.append(key, String(item)));
    } else {
      params.set(key, String(value));
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export const api = {
  interests: () => request<Interest[]>("/v1/interests", { revalidate: 3600 }),

  events: (query: EventQuery = {}) =>
    request<EventList>(`/v1/events${toSearchParams(query)}`, { revalidate: 120 }),

  trending: (city?: string, limit = 12) =>
    request<EventList>(`/v1/events/trending${toSearchParams({ city, limit })}`, {
      revalidate: 300,
    }),

  event: (id: string) => request<QwendoEvent>(`/v1/events/${id}`, { revalidate: 300 }),

  recommendations: (token: string, query: EventQuery = {}) =>
    request<EventList>(`/v1/recommendations${toSearchParams(query)}`, { token }),

  preview: (body: {
    interests: string[];
    interest_text?: string;
    city?: string;
    limit?: number;
  }) => request<EventList>("/v1/recommendations/preview", { method: "POST", body }),

  me: (token: string) => request<Me>("/v1/me", { token }),

  updateInterests: (
    token: string,
    body: { interests: string[]; interest_text?: string | null; city?: string | null },
  ) => request<Me>("/v1/me/interests", { token, method: "PUT", body }),

  updateProfile: (token: string, body: Record<string, unknown>) =>
    request<Me>("/v1/me/profile", { token, method: "PUT", body }),

  saved: (token: string) => request<EventList>("/v1/me/saved", { token }),

  save: (token: string, eventId: string, state: "saved" | "going" | "dismissed" = "saved") =>
    request<{ ok: boolean }>(`/v1/events/${eventId}/save`, {
      token,
      method: "PUT",
      body: { state },
    }),

  unsave: (token: string, eventId: string) =>
    request<{ ok: boolean }>(`/v1/events/${eventId}/save`, { token, method: "DELETE" }),

  trackClick: (eventId: string, surface: string, token?: string | null) =>
    request<{ ok: boolean }>(`/v1/events/${eventId}/click`, {
      token,
      method: "POST",
      body: { surface },
    }),
};
