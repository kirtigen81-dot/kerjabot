/** @type {import('next').NextConfig} */
const nextConfig = {
  // The dev "N" badge sits on top of the skill.md button in the bottom-left corner
  devIndicators: false,
  // Keep the browser packages out of the bundle so the Chromium binary ships intact
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/api/chat": ["./node_modules/@sparticuz/chromium/bin/**", "./skills/**"],
  },
};

export default nextConfig;
