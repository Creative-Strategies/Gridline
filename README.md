# Gridline

Gridline is a from-scratch, local-first Excel workbook viewer for Next.js. A Rust/WebAssembly core parses OOXML workbooks, resolves shared strings and styles, formats values, and produces a viewport display list. A React canvas surface renders only the visible cells.

No workbook data leaves the browser, and no third-party spreadsheet engine is embedded. The workbook bytes are transferred to a Web Worker, parsed by Rust compiled to WebAssembly, and painted through a virtualized canvas.

## Install

```bash
npm install gridline-viewer
```

Configure Next.js once with the package helper:

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withGridline } from "gridline-viewer/next";

const nextConfig: NextConfig = { reactStrictMode: true };
export default withGridline(nextConfig);
```

Next.js 16 uses Turbopack by default, and Gridline supports its development and
production pipelines without custom loader rules. For Next.js 15 or an
application that explicitly runs `next dev --webpack` / `next build --webpack`,
use `withGridline(nextConfig, { bundler: "webpack" })`.

### Content Security Policy

Gridline compiles WebAssembly inside a module Web Worker. If the host sends a
Content Security Policy, add `'wasm-unsafe-eval'` to `script-src` on **both the
document and worker responses**. Keep ordinary JavaScript `'unsafe-eval'`
disabled. A route-only header for the page is insufficient because a worker is
its own CSP global object.

For Next.js, use a global matcher (or equivalent matchers that cover both the
page and Next.js worker assets under `/_next/static/`):

```ts
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
    ];
  },
};

export default withGridline(nextConfig);
```

The `'unsafe-inline'` entries accommodate the basic Next.js example and may be
replaced by the host's existing nonce or hash policy. Do not replace
`'wasm-unsafe-eval'` with the broader `'unsafe-eval'` token.

Gridline adds its release version to the worker bootstrap's real HTTP query
string (for example, `?gridline-worker=0.2.1`). This changes the worker cache
key on every Gridline upgrade, preventing an immutable cached worker response
from retaining stale CSP metadata. The `withGridline` helper also keeps the
worker bootstrap same-origin when ordinary Next.js assets use a CDN.

## Workspace

- `crates/gridline-core` — Rust workbook model, XLSX parser, formatter, formula primitives, and WASM viewport API.
- `packages/gridline-react` — published as `gridline-viewer`; embeddable React viewer, worker bridge, and canvas renderer.
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

import { GridlineViewer } from "gridline-viewer";

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

### Compact read-only embedding

For financial-model portals and other hosts that already provide their own page
title, downloads, and document controls, use the supported compact viewer:

```tsx
<GridlineViewer
  autoLoadDemo={false}
  initialSheet="Dashboard"
  mode="compact"
  source={{
    type: "url",
    url: signedDownloadUrl,
    name: "Atlas financial model.xlsx",
  }}
/>
```

Compact mode removes Gridline branding, the repeated workbook filename, disabled
undo/redo controls, formula and cell-address bars, the duplicate sheet rail,
status bar, and platform-owned file actions. Accessible sheet tabs and zoom
remain available. The standard desktop layout uses 234px of non-canvas chrome;
compact mode uses 76px, returning 158px to the workbook.

`initialSheet` accepts a case-insensitive sheet name or a zero-based sheet
index. `defaultSheet` is also supported; when both are provided, `initialSheet`
wins. Invalid or missing sheets safely fall back to the first worksheet.

Each surface can be restored or hidden independently:

```tsx
<GridlineViewer
  mode="compact"
  initialSheet="Dashboard"
  chrome={{
    branding: false,
    title: false,
    sheetRail: true,
    sheetTabs: false,
    exportButton: true,
  }}
/>
```

`GridlineChromeOptions` supports `topBar`, `branding`, `title`, `toolbar`,
`formulaBar`, `sheetRail`, `sheetTabs`, `statusBar`, `openButton`,
`exportButton`, `workbookMenu`, and `zoom`. Keep a sheet navigation surface and
zoom available unless the host supplies accessible equivalents through
`GridlineController`. Hiding `openButton` also disables user-initiated file
drops; controller-driven, signed-URL, encrypted, and resolver sources remain
available.

The reference app uses the `withGridline` helper to transpile the viewer and
WASM packages. Turbopack handles the worker and `.wasm` asset directly. In
Webpack compatibility mode, the helper also enables `asyncWebAssembly`, assigns
a stable static asset path, and composes any existing Webpack callback. The
viewer must be imported by a client component; the worker keeps workbook parsing
out of the server-rendering path and off the main browser thread.

The component is read-only and intentionally opinionated. It includes local and cloud loading, Office and platform-encrypted documents, exact-source and encrypted downloads, cancellation/progress, sheet navigation, selection, formula inspection, zoom, sparse scrolling, hidden dimensions, sheet-controlled gridline visibility, pinned frozen panes, and CSV export. `GridlineController`, `GridlineViewerProps`, `WorkbookEngineClient`, and `useWorkbookEngine` are exported for typed integrations that need platform control or custom chrome. See [`docs/platform-integration.md`](docs/platform-integration.md) and the `/platform` reference route.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm pack:check
```

See [`docs/architecture.md`](docs/architecture.md) for the engine contract and current OOXML support.
Maintainers should also read [`docs/releasing.md`](docs/releasing.md) before
publishing a new npm version.

## Atlas reference workbook

The supplied `Atlas_AI_Factory_Economics_Model_Service_V1.xlsx` is used as a local compatibility fixture without being copied into the repository. It exercises 13 worksheets, cross-sheet formulas, custom financial formats, merged headings, tables, drawings, images, and a chart-like dashboard surface. See [`docs/atlas-compatibility.md`](docs/atlas-compatibility.md) for the exact coverage and known limits after running the compatibility audit.
