import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

// Bundle analysis: `ANALYZE=true bun run build` (or npm/yarn equivalent) writes
// interactive treemaps to .next/analyze/*.html. Wrapping is a no-op unless the
// env var is set, so it costs nothing in normal builds.
const withBundleAnalyzerPlugin = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
  // Write the treemaps to .next/analyze/*.html instead of popping browser tabs.
  openAnalyzer: false,
});

const nextConfig: NextConfig = {
  output: "standalone",
  // Prisma's generated client resolves through a hashed internal shim
  // ("@prisma/client-<hash>") that Turbopack's external-module handling
  // doesn't resolve reliably in dev. Treat it as a stable server external so
  // it's always loaded by Node's resolver instead of the bundler.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: true,

  // --- Production output tuning -------------------------------------------
  // Server responses are gzipped by Next's own compress middleware. It is on
  // by default; pinning it here means a host or proxy that flips the default
  // can't silently un-compress us. (Put a CDN in front for Brotli — see the
  // deployment notes.)
  compress: true,
  // Stop advertising "X-Powered-By: Next.js" on every response.
  poweredByHeader: false,
  // Client JS is minified by SWC unconditionally in Next 16 — the old
  // `swcMinify` flag no longer exists. Keep browser source maps off so the
  // client payload stays lean and internals aren't shipped to users.
  productionBrowserSourceMaps: false,

  // --- Image optimization --------------------------------------------------
  images: {
    // Product/auction images are admin-uploaded (emoji or /uploads/... URLs)
    // served from this origin, so no remotePatterns are needed. AVIF first,
    // WebP fallback — both handled by the built-in optimizer.
    formats: ["image/avif", "image/webp"],
  },

  // --- Bundle hygiene -------------------------------------------------------
  // Strip console.* from production client bundles. Server-side console.error
  // (audit failures, etc.) is unaffected — this only rewrites client code.
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error"] } : false,
  },

  // --- Import optimization --------------------------------------------------
  // Barrels get per-icon module imports; everything else is already directly
  // imported (shadcn/radix) so there's nothing more to list here.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },

  // --- Static asset caching -------------------------------------------------
  // In production _next/static content is content-hashed, so it is safe to
  // cache forever, and uploads under /uploads/ are immutable once written
  // (random filenames). Everything else keeps Next's defaults — user-aware
  // pages must not be cached by shared caches.
  //
  // In development neither is true: dev chunk *filenames* are stable while
  // their contents change on every edit. Caching them (even with a short max
  // age) makes the browser execute yesterday's code, which shows up as
  // "the fix disappeared" / buttons that no longer exist in the source. Dev
  // therefore opts out of caching entirely.
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: isProd
              ? "public, max-age=31536000, immutable"
              : "no-store, must-revalidate",
          },
        ],
      },
      {
        source: "/uploads/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: isProd ? "public, max-age=2592000" : "no-store, must-revalidate",
          },
        ],
      },
    ]
  },
};

export default withBundleAnalyzerPlugin(nextConfig);

