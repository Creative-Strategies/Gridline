import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const workspace = new URL("../", import.meta.url);
const outputDirectory = new URL("packages/gridline-wasm/pkg/", workspace);

// The directory is generated and ignored. Recreate it to prevent stale or
// conflict-renamed files from entering a later npm tarball.
rmSync(outputDirectory, { force: true, recursive: true });

const result = spawnSync(
  "wasm-pack",
  [
    "build",
    "crates/gridline-core",
    "--target",
    "web",
    "--out-dir",
    "../../packages/gridline-wasm/pkg",
    "--out-name",
    "gridline_core",
  ],
  { cwd: workspace, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// wasm-pack ignores generated output for source-control hygiene. The nested
// ignore file must not reach npm's packlist or it excludes the WASM payload.
rmSync(new URL(".gitignore", outputDirectory), {
  force: true,
});
