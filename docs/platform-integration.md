# Platform integration

Gridline can be embedded as a declarative React component or controlled by a long-lived platform controller. Every source is resolved and decrypted in the browser, then copied into an isolated Web Worker for Rust/WASM parsing.

## Declarative cloud source

Use a signed object URL, an authenticated request, or a resolver backed by your cloud SDK:

```tsx
"use client";

import { GridlineViewer, type GridlineSource } from "gridline-viewer";

const source: GridlineSource = {
  type: "url",
  url: signedUrl,
  name: "FY26-plan.xlsx",
  request: { credentials: "include" },
};

export function WorkbookPage() {
  return <GridlineViewer source={source} autoLoadDemo={false} />;
}
```

For an S3, GCS, Azure Blob, or proprietary SDK, defer resolution until the viewer starts a load. The resolver receives an `AbortSignal` and may return a `Blob`, `ArrayBuffer`, `Uint8Array`, `Response`, or a descriptor with metadata and encryption settings.

```tsx
const source: GridlineSource = {
  type: "resolver",
  name: "board-plan.xlsx",
  resolve: async ({ signal }) => {
    const signedUrl = await getShortLivedDownloadUrl({ signal });
    return fetch(signedUrl, { signal });
  },
};
```

Remote hosts must allow the embedding origin through CORS. Prefer short-lived, read-only signed URLs. Do not expose long-lived cloud credentials or service tokens to the browser. If an end user can influence the URL, enforce an origin allowlist before attaching `Authorization`, cookies, or other privileged request options; redirects should remain within the same policy.

## Compact, platform-owned read-only viewer

When the surrounding platform already owns the page heading, workbook title,
downloads, and document selection, opt into Gridline's supported compact mode:

```tsx
import { GridlineViewer, type GridlineSource } from "gridline-viewer";

export function FinancialModel({ source }: { source: GridlineSource }) {
  return (
    <GridlineViewer
      autoLoadDemo={false}
      initialSheet="Dashboard"
      mode="compact"
      source={source}
    />
  );
}
```

The default compact presentation contains one 40px accessible zoom bar and one
36px accessible sheet-tab bar. It hides Gridline branding, the repeated workbook
filename, disabled undo/redo, formula tools and the address bar, the duplicate
sheet rail, the status bar, and workbook open/export/menu actions. Compared with
the full 234px desktop chrome, 158px returns to the rendered worksheet.

`initialSheet` accepts a zero-based sheet index or a case-insensitive sheet name.
`defaultSheet` is a supported alias, and `initialSheet` takes precedence if both
are supplied. Invalid names and indices safely fall back to the first sheet. The
chosen sheet is applied before the initial worksheet render, including cloud,
controller, demo, and encrypted-document flows.

Every compact default is individually configurable through `chrome`:

```tsx
<GridlineViewer
  mode="compact"
  initialSheet="Dashboard"
  chrome={{
    topBar: true,
    branding: false,
    title: false,
    toolbar: false,
    formulaBar: false,
    sheetRail: false,
    sheetTabs: true,
    statusBar: false,
    openButton: false,
    exportButton: false,
    workbookMenu: false,
    zoom: true,
  }}
/>
```

For example, use `{ sheetRail: true, sheetTabs: false }` to present exactly one
sheet navigation surface, or set `exportButton: true` to restore CSV export.
Keep at least one accessible sheet navigator and zoom surface unless equivalent
platform controls call `GridlineController.setActiveSheet()` and `setZoom()`.
When `openButton` is disabled, user-initiated file picker and drag-and-drop
replacement are unavailable; signed sources, controller-controlled loading,
password unlocking, encrypted documents, and original/encrypted downloads
through the controller remain unchanged.

## Content Security Policy and worker caching

Gridline compiles its Rust engine's WebAssembly inside a module Web Worker.
Under CSP, `script-src` therefore needs `'wasm-unsafe-eval'` on the page
response **and** the worker script response. The worker has its own CSP global
object, so a header attached only to the viewer route does not authorize WASM
compilation in the worker. Keep the broader `'unsafe-eval'` source disabled.

For the default Next.js integration, apply the policy globally or include both
the application route and worker assets under `/_next/static/` in the header
matchers.
The reference application uses:

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
    return [{
      source: "/:path*",
      headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }],
    }];
  },
};
```

Adapt the other directives to the host application. In particular, a
nonce-based Next.js policy can remove the example's `'unsafe-inline'` values;
the Gridline requirement is the narrowly scoped `'wasm-unsafe-eval'` value.

Gridline appends its package version to the worker bootstrap's real HTTP query
string (for example, `?gridline-worker=0.3.0`). Each release therefore changes
the worker's cache key while retaining immutable caching within a release.
`withGridline` also defaults Turbopack's worker-specific asset prefix to the
same origin, even when the application's ordinary Next.js assets use a CDN.

## Platform controller

`GridlineController` provides a stable integration boundary for navigation, loading, cancellation, downloads, and state observation:

```tsx
const [controller] = useState(() => new GridlineController());

useEffect(() => controller.subscribe((state) => {
  analytics.track("workbook_state", {
    status: state.status,
    phase: state.progress?.phase,
    sheet: state.activeSheet,
  });
}), [controller]);

return <GridlineViewer controller={controller} />;
```

The controller exposes `open`, `reload`, `cancel`, `unlock`, `selectCell`, `setActiveSheet`, `setZoom`, `exportCsv`, `getOriginalBlob`, `downloadOriginal`, and `downloadEncrypted`. Loading occurs in a candidate worker so a failed or cancelled load does not corrupt the currently visible workbook.

## Encrypted documents

Gridline supports three browser-side paths:

- Password-protected Office OOXML (`.xlsx`/`.xlsm` stored in an OLE encrypted container). Standard and the common SHA-512 Agile ECMA-376 profiles are decrypted inside WASM; unsupported profiles return `UNSUPPORTED_ENCRYPTION`. A password can be supplied as `officePassword`, through `passwordProvider`, through the built-in unlock dialog, or with `controller.unlock(password)`.
- Gridline envelopes. `encryptGridlineDocument` creates a versioned AES-256-GCM container with PBKDF2-SHA-256 password derivation and authenticated filename/MIME metadata. Pass `{ encryption: { type: "gridline", password } }` to reopen it.
- Platform encryption. Use the built-in `aes-gcm` source descriptor with a Web Crypto key and IV, or a `custom` decrypt callback for KMS-wrapped keys and proprietary envelopes.

```tsx
<GridlineViewer
  source={{ type: "file", file: encryptedFile }}
  passwordProvider={async ({ document }) => vault.requestPassword(document?.name)}
/>
```

`downloadOriginal()` returns the exact bytes received from the file picker or cloud host, including encryption. `downloadEncrypted(password)` creates a portable Gridline-encrypted copy from the resolved workbook payload. Passwords are never stored in controller state or emitted through progress events.

## Limits and lifecycle

The default compressed source limit is 64 MB and is enforced against `Content-Length` before download and again while streaming. The Rust engine separately limits expanded archive data, individual parts, shared/cell text, sheets, cells, formula work/depth, CSV area/output, chart points, and viewport size. Override the source cap with `maxSourceBytes`, but keep the WASM limits in mind.

Progress moves through `resolving`, `fetching`, `decrypting`, `parsing`, and `ready`. `cancel()` aborts resolvers/fetches and terminates an in-flight candidate parser. Unmounting the viewer aborts current work and disposes both workers.
