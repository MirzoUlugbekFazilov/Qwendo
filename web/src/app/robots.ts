import type { MetadataRoute } from "next";

const SITE = "https://qwendo.co";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Personal pages carry no value for search and shouldn't be crawled.
        disallow: ["/saved", "/onboarding", "/auth/", "/login"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
