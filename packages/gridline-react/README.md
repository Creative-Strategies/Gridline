# gridline-viewer

Gridline Viewer is an embeddable, read-only Excel workbook viewer for React
and Next.js. Workbook bytes stay in the browser: a Web Worker runs the
from-scratch Rust/WebAssembly OOXML engine and a virtualized Canvas surface
paints the visible cells.

## Install

~~~bash
npm install gridline-viewer
~~~

For Next.js 16, compose the supplied configuration helper. Gridline works with
the default Turbopack development and production pipelines:

~~~ts
// next.config.ts
import type { NextConfig } from "next";
import { withGridline } from "gridline-viewer/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withGridline(nextConfig);
~~~

For Next.js 15 or an application that explicitly uses Webpack, select the
compatibility mode and run Next.js with `--webpack`:

~~~ts
export default withGridline(nextConfig, { bundler: "webpack" });
~~~

`withGridline` gives worker assets a release-versioned HTTP path so browser
upgrades cannot reuse an immutable worker bootstrap cached by an earlier
Gridline release. If the application sends a Content Security Policy,
`script-src` must contain `'wasm-unsafe-eval'` on both document and worker
responses. Use a global header matcher (or explicitly cover
Next.js worker assets under `/_next/static/`) and keep the broader JavaScript
`'unsafe-eval'` token disabled. See the repository README for a complete
Next.js example.

Render the viewer from a client component:

~~~tsx
"use client";

import { GridlineViewer } from "gridline-viewer";

export function WorkbookPage({ file }: { file?: File }) {
  return <GridlineViewer initialFile={file} />;
}
~~~

For an embedded read-only financial model, use compact mode and open the
desired worksheet directly:

~~~tsx
<GridlineViewer
  mode="compact"
  initialSheet="Dashboard"
  source={{ type: "url", url: signedWorkbookUrl, name: "Atlas.xlsx" }}
/>
~~~

Compact mode keeps accessible sheet switching and zoom while removing branding,
the repeated workbook title, editor-like controls, duplicate sheet navigation,
the status bar, and file actions owned by the embedding platform. Its desktop
chrome uses 76px instead of the full viewer's 234px.

`initialSheet` accepts a case-insensitive sheet name or zero-based index.
`defaultSheet` is an alias; `initialSheet` takes precedence. Use the optional
`chrome` prop to override any surface individually:

~~~tsx
<GridlineViewer
  mode="compact"
  initialSheet="Dashboard"
  chrome={{ sheetRail: true, sheetTabs: false, exportButton: true }}
/>
~~~

The package exports `GridlineChromeOptions`, `GridlineInitialSheet`, and
`GridlineViewerMode`. Available chrome controls are `topBar`, `branding`,
`title`, `toolbar`, `formulaBar`, `sheetRail`, `sheetTabs`, `statusBar`,
`openButton`, `exportButton`, `workbookMenu`, and `zoom`.

The package also exports cloud/resolver source types, browser-side encryption
helpers, GridlineController, and the lower-level worker client. Remote URLs
are fetched by the browser and remain subject to CORS; embedding platforms
should allowlist origins and use short-lived read-only URLs.

Full integration and security documentation lives in the
[Gridline repository](https://github.com/Creative-Strategies/Gridline).
