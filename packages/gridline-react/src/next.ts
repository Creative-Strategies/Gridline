import type { NextConfig } from "next";

export interface GridlineNextOptions {
  /**
   * Select the Next.js bundler integration. Turbopack is the default and does
   * not require custom configuration on Next.js 16. Use `webpack` for Next.js
   * 15 or applications that explicitly run Next.js with `--webpack`.
   */
  bundler?: "turbopack" | "webpack";
}

/**
 * Adds the package transpilation settings required by Gridline while
 * preserving an application's existing Next.js configuration. Next.js 16's
 * default Turbopack pipeline supports Gridline's Web Worker and WASM assets
 * without additional bundler configuration.
 */
export function withGridline(
  nextConfig: NextConfig = {},
  options: GridlineNextOptions = {},
): NextConfig {
  const userWebpack = nextConfig.webpack;
  const bundler = options.bundler ?? "turbopack";
  const configured: NextConfig = {
    ...nextConfig,
    transpilePackages: [
      ...new Set([
        ...(nextConfig.transpilePackages ?? []),
        "gridline-viewer",
        "gridline-wasm",
      ]),
    ],
    ...(bundler === "turbopack"
      ? {
          experimental: {
            ...nextConfig.experimental,
            // Keep the worker entrypoint same-origin even when the host sends
            // ordinary Next.js assets to a CDN. Gridline adds its release
            // version to the entrypoint's HTTP query string at runtime.
            turbopackWorkerAssetPrefix:
              nextConfig.experimental?.turbopackWorkerAssetPrefix ?? "",
          },
        }
      : {}),
  };

  if (bundler !== "webpack") {
    return configured;
  }

  return {
    ...configured,
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
