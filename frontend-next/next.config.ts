import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence Turbopack warning; canvas is browser-native so no alias needed
  turbopack: {},
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
