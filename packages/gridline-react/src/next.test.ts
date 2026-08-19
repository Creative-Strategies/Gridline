import { describe, expect, it, vi } from "vitest";
import type { NextConfig } from "next";
import { withGridline } from "./next";
import { GRIDLINE_WORKER_ASSET_PREFIX } from "./version";

type WebpackContext = Parameters<NonNullable<NextConfig["webpack"]>>[1];

function webpackContext(isServer: boolean) {
  return { isServer } as WebpackContext;
}

describe("withGridline", () => {
  it("uses Turbopack-compatible settings by default", async () => {
    const nextConfig = withGridline({
      reactStrictMode: true,
      transpilePackages: ["customer-package", "gridline-viewer"],
    });

    expect(nextConfig).toMatchObject({ reactStrictMode: true });
    expect(nextConfig.transpilePackages).toEqual([
      "customer-package",
      "gridline-viewer",
      "gridline-wasm",
    ]);
    expect(nextConfig.webpack).toBeUndefined();
    expect(nextConfig.experimental?.turbopackWorkerAssetPrefix).toBe(
      GRIDLINE_WORKER_ASSET_PREFIX,
    );
    await expect(nextConfig.rewrites?.()).resolves.toEqual([
      {
        source: `${GRIDLINE_WORKER_ASSET_PREFIX}/_next/:path*`,
        destination: "/_next/:path*",
      },
    ]);
  });

  it("preserves an application's existing bundler configuration", () => {
    const userWebpack = vi.fn((config) => config);
    const userTurbopack = { resolveAlias: { "customer-package": "./src/package" } };
    const nextConfig = withGridline({
      turbopack: userTurbopack,
      webpack: userWebpack,
    });

    expect(nextConfig.turbopack).toBe(userTurbopack);
    expect(nextConfig.webpack).toBe(userWebpack);
  });

  it("composes existing Next.js and Webpack settings in Webpack mode", () => {
    const userWebpack = vi.fn((config) => ({ ...config, userConfigured: true }));
    const nextConfig = withGridline(
      {
        reactStrictMode: true,
        transpilePackages: ["customer-package", "gridline-viewer"],
        webpack: userWebpack,
      },
      { bundler: "webpack" },
    );

    expect(nextConfig.transpilePackages).toEqual([
      "customer-package",
      "gridline-viewer",
      "gridline-wasm",
    ]);
    const configured = nextConfig.webpack?.(
      { experiments: { layers: true }, output: { clean: true } },
      webpackContext(false),
    );
    expect(userWebpack).toHaveBeenCalledOnce();
    expect(configured).toMatchObject({
      userConfigured: true,
      experiments: { layers: true, asyncWebAssembly: true },
      output: {
        clean: true,
        workerPublicPath: `${GRIDLINE_WORKER_ASSET_PREFIX}/_next/`,
        webassemblyModuleFilename: "static/wasm/[modulehash].wasm",
      },
    });
  });

  it("prepends its worker route without discarding structured rewrites", async () => {
    const existing = {
      beforeFiles: [{ source: "/before", destination: "/before-target" }],
      afterFiles: [{ source: "/after", destination: "/after-target" }],
      fallback: [{ source: "/fallback", destination: "/fallback-target" }],
    };
    const nextConfig = withGridline({ rewrites: async () => existing });

    await expect(nextConfig.rewrites?.()).resolves.toEqual({
      ...existing,
      beforeFiles: [
        {
          source: `${GRIDLINE_WORKER_ASSET_PREFIX}/_next/:path*`,
          destination: "/_next/:path*",
        },
        ...existing.beforeFiles,
      ],
    });
  });

  it("preserves an explicit external worker asset prefix", async () => {
    const nextConfig = withGridline({
      experimental: {
        turbopackWorkerAssetPrefix: "https://workers.example.com",
      },
    });

    expect(nextConfig.experimental?.turbopackWorkerAssetPrefix).toBe(
      "https://workers.example.com",
    );
    expect(nextConfig.rewrites).toBeUndefined();
  });

  it("uses the server-safe WASM output path", () => {
    const configured = withGridline({}, { bundler: "webpack" }).webpack?.(
      {},
      webpackContext(true),
    );
    expect(configured?.output?.webassemblyModuleFilename).toBe(
      "../static/wasm/[modulehash].wasm",
    );
  });
});
