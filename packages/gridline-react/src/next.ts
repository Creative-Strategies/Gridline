import type { NextConfig } from "next";
import { GRIDLINE_WORKER_ASSET_PREFIX } from "./version.js";

type NextRewrites = Awaited<
  ReturnType<NonNullable<NextConfig["rewrites"]>>
>;

type NextRewrite = {
  source: string;
  destination: string;
};

export interface GridlineNextOptions {
  /**
   * Select the Next.js bundler integration. Turbopack is the default and does
   * not require custom configuration on Next.js 16. Use `webpack` for Next.js
   * 15 or applications that explicitly run Next.js with `--webpack`.
   */
  bundler?: "turbopack" | "webpack";
  /**
   * Same-origin prefix for Gridline's versioned worker entrypoint and module
   * chunks. Override only when the host provides an equivalent versioned
   * route; the default is updated for every Gridline release.
   */
  workerAssetPrefix?: string;
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
  const userRewrites = nextConfig.rewrites;
  const bundler = options.bundler ?? "turbopack";
  const configuredWorkerPrefix =
    nextConfig.experimental?.turbopackWorkerAssetPrefix;
  const workerAssetPrefix =
    options.workerAssetPrefix ??
    (typeof configuredWorkerPrefix === "string"
      ? configuredWorkerPrefix
      : GRIDLINE_WORKER_ASSET_PREFIX);
  const workerRewrite = createWorkerRewrite(workerAssetPrefix);
  const configured: NextConfig = {
    ...nextConfig,
    transpilePackages: [
      ...new Set([
        ...(nextConfig.transpilePackages ?? []),
        "gridline-viewer",
        "gridline-wasm",
      ]),
    ],
    ...(workerRewrite
      ? {
          async rewrites() {
            return prependRewrite(await userRewrites?.(), workerRewrite);
          },
        }
      : {}),
    ...(bundler === "turbopack"
      ? {
          experimental: {
            ...nextConfig.experimental,
            turbopackWorkerAssetPrefix: workerAssetPrefix,
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
        ...(workerRewrite
          ? { workerPublicPath: `${workerAssetPrefix}/_next/` }
          : {}),
        webassemblyModuleFilename: context.isServer
          ? "../static/wasm/[modulehash].wasm"
          : "static/wasm/[modulehash].wasm",
      };
      return configured;
    },
  };
}

function createWorkerRewrite(prefix: string): NextRewrite | undefined {
  if (!prefix.startsWith("/")) return undefined;
  const normalized = prefix.replace(/\/+$/, "");
  return {
    source: `${normalized}/_next/:path*`,
    destination: "/_next/:path*",
  } as NextRewrite;
}

function prependRewrite(
  rewrites: NextRewrites | undefined,
  workerRewrite: NextRewrite,
): NextRewrites {
  if (!rewrites) return [workerRewrite] as NextRewrites;
  if (Array.isArray(rewrites)) {
    return [workerRewrite, ...rewrites] as NextRewrites;
  }
  return {
    ...rewrites,
    beforeFiles: [workerRewrite, ...(rewrites.beforeFiles ?? [])],
  } as NextRewrites;
}
