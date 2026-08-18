# Gridline

Gridline is a from-scratch, local-first Excel workbook viewer for Next.js. A Rust/WebAssembly core parses OOXML workbooks, resolves shared strings and styles, formats values, and produces a viewport display list. A React canvas surface renders only the visible cells.

No workbook data leaves the browser, and no third-party spreadsheet engine is embedded. The workbook bytes are transferred to a Web Worker, parsed by Rust compiled to WebAssembly, and painted through a virtualized canvas.

## Workspace

- `crates/gridline-core` — Rust workbook model, XLSX parser, formatter, formula primitives, and WASM viewport API.
- `packages/gridline-react` — embeddable React viewer, worker bridge, and canvas renderer.
- `packages/gridline-wasm` — generated `wasm-pack` output (not committed).
- `apps/demo` — Next.js reference integration.

## Development

```bash
pnpm install
pnpm build:wasm
pnpm dev
```

Then open `http://localhost:3000` and drop an `.xlsx` file onto the viewer.

Prerequisites: Node.js 20+, pnpm 10+, Rust, and `wasm-pack`.

## Embed in Next.js

Build the WASM package before starting or building Next.js:

```bash
pnpm build:wasm
```

Render the viewer from a client component:

```tsx
"use client";

import { GridlineViewer } from "@gridline/react";

export function WorkbookView({ file }: { file?: File }) {
  return (
    <GridlineViewer
      initialFile={file}
      initialZoom={1}
      onError={(error) => console.error(error)}
      onWorkbookOpen={(file) => console.info("Opened", file.name)}
    />
  );
}
```

Cloud-hosted and platform-encrypted workbooks can be supplied directly:

```tsx
<GridlineViewer
  autoLoadDemo={false}
  source={{
    type: "url",
    url: signedDownloadUrl,
    name: "Operating Plan.xlsx",
    request: { credentials: "include" },
  }}
  onLoadProgress={({ phase, percent }) => console.info(phase, percent)}
/>
```

The reference app uses webpack because the generated module ships a `.wasm` asset. Its [`next.config.ts`](apps/demo/next.config.ts) enables `asyncWebAssembly`, assigns a stable static asset path, and transpiles the two workspace packages. The viewer must be imported by a client component; the worker keeps workbook parsing out of the server-rendering path and off the main browser thread.

The component is read-only and intentionally opinionated. It includes local and cloud loading, Office and platform-encrypted documents, exact-source and encrypted downloads, cancellation/progress, sheet navigation, selection, formula inspection, zoom, sparse scrolling, hidden dimensions, sheet-controlled gridline visibility, pinned frozen panes, and CSV export. `GridlineController`, `GridlineViewerProps`, `WorkbookEngineClient`, and `useWorkbookEngine` are exported for typed integrations that need platform control or custom chrome. See [`docs/platform-integration.md`](docs/platform-integration.md) and the `/platform` reference route.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
```

See [`docs/architecture.md`](docs/architecture.md) for the engine contract and current OOXML support.

## Atlas reference workbook

The supplied `Atlas_AI_Factory_Economics_Model_Service_V1.xlsx` is used as a local compatibility fixture without being copied into the repository. It exercises 13 worksheets, cross-sheet formulas, custom financial formats, merged headings, tables, drawings, images, and a chart-like dashboard surface. See [`docs/atlas-compatibility.md`](docs/atlas-compatibility.md) for the exact coverage and known limits after running the compatibility audit.
