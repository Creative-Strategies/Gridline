import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";

const workspace = new URL("../", import.meta.url);

run("pnpm", ["build:packages"]);

await Promise.all([
  access(new URL("packages/gridline-wasm/pkg/gridline_core_bg.wasm", workspace)),
  access(new URL("packages/gridline-react/dist/index.js", workspace)),
  access(new URL("packages/gridline-react/dist/index.d.ts", workspace)),
  access(new URL("packages/gridline-react/dist/next.js", workspace)),
  access(new URL("packages/gridline-react/dist/engine/workbook.worker.js", workspace)),
  access(new URL("packages/gridline-react/dist/viewer/gridline.css", workspace)),
]);

const wasmFiles = packFiles("./packages/gridline-wasm");
assertPacked(wasmFiles, [
  "pkg/gridline_core.js",
  "pkg/gridline_core.d.ts",
  "pkg/gridline_core_bg.wasm",
]);

const viewerFiles = packFiles("./packages/gridline-react");
assertPacked(viewerFiles, [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/next.js",
  "dist/engine/workbook.worker.js",
  "dist/viewer/gridline.css",
]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function packFiles(packageDirectory) {
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts", packageDirectory],
    { cwd: workspace, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  const [manifest] = JSON.parse(result.stdout);
  console.info(
    `${manifest.name}@${manifest.version}: ${manifest.files.length} packed files`,
  );
  return new Set(manifest.files.map((entry) => entry.path));
}

function assertPacked(files, required) {
  for (const path of required) {
    if (!files.has(path)) {
      throw new Error(`Required package artifact is missing: ${path}`);
    }
  }
}
