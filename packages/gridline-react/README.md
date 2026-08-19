# gridline-viewer

Gridline Viewer is an embeddable, read-only Excel workbook viewer for React
and Next.js. Workbook bytes stay in the browser: a Web Worker runs the
from-scratch Rust/WebAssembly OOXML engine and a virtualized Canvas surface
paints the visible cells.

## Install

~~~bash
npm install gridline-viewer
~~~

For Next.js, compose the supplied configuration helper and use Webpack:

~~~ts
// next.config.ts
import type { NextConfig } from "next";
import { withGridline } from "gridline-viewer/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withGridline(nextConfig);
~~~

~~~json
{
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack"
  }
}
~~~

Render the viewer from a client component:

~~~tsx
"use client";

import { GridlineViewer } from "gridline-viewer";

export function WorkbookPage({ file }: { file?: File }) {
  return <GridlineViewer initialFile={file} />;
}
~~~

The package also exports cloud/resolver source types, browser-side encryption
helpers, GridlineController, and the lower-level worker client. Remote URLs
are fetched by the browser and remain subject to CORS; embedding platforms
should allowlist origins and use short-lived read-only URLs.

Full integration and security documentation lives in the
[Gridline repository](https://github.com/Creative-Strategies/Gridline).

