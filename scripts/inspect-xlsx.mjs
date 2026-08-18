import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import initWasm, { WorkbookHandle } from "../packages/gridline-wasm/pkg/gridline_core.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: pnpm inspect:xlsx /absolute/path/to/workbook.xlsx");
  process.exit(2);
}

const workbookPath = resolve(input);
const [wasm, workbookBytes] = await Promise.all([
  readFile(new URL("../packages/gridline-wasm/pkg/gridline_core_bg.wasm", import.meta.url)),
  readFile(workbookPath),
]);

await initWasm({ module_or_path: wasm });

const handle = new WorkbookHandle(workbookBytes);
try {
  const metadata = handle.metadata();
  console.log(
    JSON.stringify(
      {
        file: basename(workbookPath),
        ...metadata,
      },
      null,
      2,
    ),
  );
} finally {
  handle.free();
}
