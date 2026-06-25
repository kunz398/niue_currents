import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/currents",
  env: {
    NEXT_PUBLIC_BASE_PATH: "/currents",
  },
  transpilePackages: [
    "deck.gl",
    "@deck.gl/core",
    "@deck.gl/layers",
    "@deck.gl/react",
    "@deck.gl/aggregation-layers",
    "maplibre-gl",
  ],
};

export default nextConfig;
