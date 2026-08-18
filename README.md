# Gridline

Gridline is a from-scratch, local-first Excel workbook viewer for Next.js. A Rust/WebAssembly core parses OOXML workbooks, resolves shared strings and styles, formats values, and produces a viewport display list. A React canvas surface renders only the visible cells.

No workbook data leaves the browser, and no third-party spreadsheet engine is embedded.

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

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
```

See [`docs/architecture.md`](docs/architecture.md) for the engine contract and current OOXML support.

