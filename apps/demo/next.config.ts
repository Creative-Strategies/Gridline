import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
  transpilePackages: ["@gridline/react", "gridline-core"],
  webpack(config, { isServer }) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    if (isServer) {
      config.output.webassemblyModuleFilename = "../static/wasm/[modulehash].wasm";
    } else {
      config.output.webassemblyModuleFilename = "static/wasm/[modulehash].wasm";
    }
    return config;
  },
};

export default nextConfig;
