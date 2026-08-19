import type { NextConfig } from "next";

/**
 * Adds the Webpack settings required by wasm-pack's browser target while
 * preserving an application's existing Next.js configuration.
 *
 * Gridline currently requires `next dev --webpack` / `next build --webpack`.
 */
export function withGridline(nextConfig: NextConfig = {}): NextConfig {
  const userWebpack = nextConfig.webpack;
  return {
    ...nextConfig,
    transpilePackages: [
      ...new Set([
        ...(nextConfig.transpilePackages ?? []),
        "gridline-viewer",
        "gridline-wasm",
      ]),
    ],
    webpack(config, context) {
      const configured = userWebpack?.(config, context) ?? config;
      configured.experiments = {
        ...configured.experiments,
        asyncWebAssembly: true,
      };
      configured.output = {
        ...configured.output,
        webassemblyModuleFilename: context.isServer
          ? "../static/wasm/[modulehash].wasm"
          : "static/wasm/[modulehash].wasm",
      };
      return configured;
    },
  };
}
