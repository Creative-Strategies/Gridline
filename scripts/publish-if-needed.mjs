import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageDirectory = process.argv[2];
if (!packageDirectory) {
  throw new Error("Usage: node scripts/publish-if-needed.mjs <package-directory>");
}

const manifestPath = resolve(packageDirectory, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const specifier = `${manifest.name}@${manifest.version}`;

const lookup = spawnSync("npm", ["view", specifier, "version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (lookup.status === 0 && lookup.stdout.trim() === manifest.version) {
  console.info(`${specifier} is already published; skipping.`);
  process.exit(0);
}

const publish = spawnSync(
  "npm",
  ["publish", packageDirectory, "--access", "public"],
  { stdio: "inherit" },
);

if (publish.error) throw publish.error;
process.exit(publish.status ?? 1);
