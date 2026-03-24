import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Force Node.js runtime — required for db0's SQLite backend
  experimental: {
    serverComponentsExternalPackages: ["sql.js"],
  },
};

export default nextConfig;
