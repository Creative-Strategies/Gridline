import { describe, expect, it, vi } from "vitest";
import type { NextConfig } from "next";
import { withGridline } from "./next";

type WebpackContext = Parameters<NonNullable<NextConfig["webpack"]>>[1];

function webpackContext(isServer: boolean) {
  return { isServer } as WebpackContext;
}

describe("withGridline", () => {
  it("composes existing Next.js and Webpack settings", () => {
    const userWebpack = vi.fn((config) => ({ ...config, userConfigured: true }));
    const nextConfig = withGridline({
      reactStrictMode: true,
      transpilePackages: ["customer-package", "gridline-viewer"],
      webpack: userWebpack,
    });

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
        webassemblyModuleFilename: "static/wasm/[modulehash].wasm",
      },
    });
  });

  it("uses the server-safe WASM output path", () => {
    const configured = withGridline({}).webpack?.({}, webpackContext(true));
    expect(configured?.output?.webassemblyModuleFilename).toBe(
      "../static/wasm/[modulehash].wasm",
    );
  });
});
