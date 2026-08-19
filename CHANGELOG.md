# Changelog

All notable changes to Gridline are documented here.

## 0.2.1

- Give Turbopack and Webpack worker entrypoints a release-versioned,
  same-origin URL so an upgrade cannot reuse an immutable worker bootstrap
  cached with stale response headers.
- Add a worker/runtime version handshake that rejects mixed Gridline assets
  with an actionable reload error instead of silently running mismatched code.
- Document and exercise the Content Security Policy required for local WASM:
  `script-src` must include `'wasm-unsafe-eval'` on both document and worker
  responses, while ordinary JavaScript `'unsafe-eval'` remains unnecessary.

## 0.2.0

- Support Next.js 16's default Turbopack development and production pipelines,
  including Web Worker and WebAssembly asset emission.
- Make `withGridline` Turbopack-first while retaining explicit Webpack
  compatibility for Next.js 15 and applications that use `--webpack`.
- Run the reference application with Turbopack by default.

## 0.1.0

- Initial public Rust/WebAssembly OOXML workbook engine.
- Embeddable React/Next.js Canvas viewer and platform controller.
- Local files, signed cloud URLs, custom resolvers, Office-encrypted workbooks,
  AES-GCM platform sources, and portable Gridline encrypted downloads.
- Cross-sheet formula evaluation, hidden rows/columns, worksheet gridline
  visibility, frozen panes, merged cells, styles, and bounded chart extraction.
- Public gridline-viewer and gridline-wasm npm packages with OIDC-ready release
  automation and provenance metadata.
