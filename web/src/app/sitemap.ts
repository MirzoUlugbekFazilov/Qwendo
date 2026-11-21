import type { MetadataRoute } from "next";

import { EMPTY_LIST, api, safe } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/format";

const SITE = "https://qwendo.co";

// Regenerated hourly: the event set changes as ingestion runs.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE}/discover`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
  ];

  const categoryPages: MetadataRoute.Sitemap = Object.keys(CATEGORY_LABELS).map((slug) => ({
    url: `${SITE}/discover?categories=${slug}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  // Individual events are the long tail worth indexing. If the API is cold or
  // down, ship the static pages rather than failing the whole sitemap.
  const events = await safe(api.events({ limit: 100 }), EMPTY_LIST);
  const eventPages: MetadataRoute.Sitemap = events.items.map((event) => ({
    url: `${SITE}/events/${event.id}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticPages, ...categoryPages, ...eventPages];
}
