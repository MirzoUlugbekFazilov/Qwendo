import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A stray package-lock.json in the user's home directory makes Next infer the
  // wrong workspace root; pin it to this app.
  outputFileTracingRoot: __dirname,
  images: {
    // Event artwork is hotlinked from the marketplaces we aggregate.
    remotePatterns: [
      { protocol: "https", hostname: "**.ticketm.net" },
      { protocol: "https", hostname: "**.evbuc.com" },
      { protocol: "https", hostname: "**.eventbrite.com" },
      { protocol: "https", hostname: "**.lumacdn.com" },
      { protocol: "https", hostname: "**.lu.ma" },
      { protocol: "https", hostname: "images.lumacdn.com" },
      { protocol: "https", hostname: "cdn.evbuc.com" },
    ],
  },
};

export default nextConfig;
