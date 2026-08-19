import { readFile } from "node:fs/promises";

const workspace = new URL("../", import.meta.url);
const packagePaths = [
  "packages/gridline-wasm/package.json",
  "packages/gridline-react/package.json",
];
const packages = await Promise.all(
  packagePaths.map(async (path) =>
    JSON.parse(await readFile(new URL(path, workspace), "utf8")),
  ),
);
const versions = new Set(packages.map((manifest) => manifest.version));
const cargoManifest = await readFile(
  new URL("crates/gridline-core/Cargo.toml", workspace),
  "utf8",
);
const cargoVersion = cargoManifest.match(
  /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
)?.[1];

if (!cargoVersion) {
  throw new Error("Could not read the gridline-core Cargo package version");
}

versions.add(cargoVersion);

const viewerVersionSource = await readFile(
  new URL("packages/gridline-react/src/version.ts", workspace),
  "utf8",
);
const viewerSourceVersion = viewerVersionSource.match(
  /GRIDLINE_VERSION\s*=\s*"([^"]+)"/,
)?.[1];
if (!viewerSourceVersion) {
  throw new Error("Could not read GRIDLINE_VERSION from source");
}
versions.add(viewerSourceVersion);

if (versions.size !== 1) {
  throw new Error(
    "Publishable package versions must match: " +
      packages
        .map((manifest) => manifest.name + "@" + manifest.version)
        .concat(
          `gridline-core@${cargoVersion}`,
          `GRIDLINE_VERSION@${viewerSourceVersion}`,
        )
        .join(", "),
  );
}

const [version] = versions;
if (process.env.GITHUB_REF_TYPE === "tag") {
  const expectedTag = "v" + version;
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    throw new Error(
      "Release tag " +
        process.env.GITHUB_REF_NAME +
        " does not match " +
        expectedTag,
    );
  }
}

console.info(
  "Release verified: " +
    packages
      .map((manifest) => manifest.name + "@" + manifest.version)
      .join(", "),
);
