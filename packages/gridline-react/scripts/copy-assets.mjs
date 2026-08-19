import { copyFile, mkdir } from "node:fs/promises";

const packageRoot = new URL("../", import.meta.url);
const outputDirectory = new URL("dist/viewer/", packageRoot);

await mkdir(outputDirectory, { recursive: true });
await copyFile(
  new URL("src/viewer/gridline.css", packageRoot),
  new URL("gridline.css", outputDirectory),
);
