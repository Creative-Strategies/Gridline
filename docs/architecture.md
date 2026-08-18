# Gridline architecture

## Design goal

Gridline is an embeddable read-only workbook surface, not a browser office suite. Its first release optimizes for safe local viewing, fidelity for common `.xlsx` workbooks, deterministic rendering, and smooth navigation through large sparse sheets.

The engine is “from scratch” at the spreadsheet layer: Gridline owns the workbook model, OOXML relationship traversal, worksheet semantics, style resolution, number formatting, simple formula evaluation, viewport layout, and canvas renderer. It uses small commodity crates only for ZIP decompression, XML tokenization, and JavaScript bindings; it does not wrap SheetJS, ExcelJS, Handsontable, Luckysheet, Univer, or Microsoft Office components.

## Data flow

1. The source layer resolves a local file, byte buffer, signed URL, authenticated request, or custom cloud resolver with cancellation and streaming limits.
2. Platform-encrypted bytes are decrypted with Web Crypto or a host callback while the exact source blob is retained for download.
3. The browser transfers the resolved workbook payload to a candidate module worker. A candidate replaces the active worker only after a successful parse.
4. Rust/WASM detects and decrypts password-protected Office containers, opens the OOXML ZIP, and resolves workbook relationships.
5. The core builds a sparse workbook model with shared styles and strings.
6. React requests a row/column window based on scroll position.
7. WASM returns a compact display list with geometry, formatted text, and resolved paint tokens.
8. The React canvas renderer paints the display list at device-pixel resolution and keeps DOM overlays only for interaction and accessibility.

## Package boundaries

- `gridline-core` has no React or Next.js dependency and can be tested natively.
- `@gridline/react` owns source resolution, encryption envelopes, candidate-worker lifecycle, platform control, scrolling, selection, file input, and canvas painting.
- `@gridline/demo` proves App Router integration without server-side WASM execution.

## Supported OOXML surface

- Workbook/sheet relationships and visibility.
- Shared strings, inline strings, booleans, numbers, errors, formulas, and cached formula values.
- Fonts, solid fills, borders, alignments, built-in/custom number formats, row heights, column widths, and hidden row/column dimensions.
- Merged cells, worksheet gridline visibility, and truly pinned frozen row/column panes across scrolling, selection, and hit-testing.
- Sparse, virtualized viewport extraction, address lookup, text search, and CSV export.
- Workbook-wide formula dependencies, quoted/unquoted cross-sheet references, absolute references, comparisons, text literals, arithmetic, and the bounded `IF`, `ABS`, `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `COUNTBLANK`, `COUNTIF`, and `COUNTIFS` subset when a cached value is unavailable.
- First-series line-chart extraction from worksheet drawing relationships, including Atlas-style nested chart parts and cell-backed categories/values.

Deliberately deferred: editing and save-back, macros, external links, structured table references, pivot tables, conditional-format rules, embedded image decoding, multi-series/native Excel chart fidelity, and page-layout rendering. Unsupported objects are ignored without preventing the sheet grid from loading.

## Security and resource limits

Parsing and Office decryption stay in a worker. The source layer caps remote data before and during streaming; the core separately rejects oversized archives, excessive expanded XML, too many sheets/cells, invalid relationship targets, and malformed coordinates. Formulas are interpreted as data by a small evaluator; they are never executed as JavaScript. Passwords are passed only to the active decrypt operation and are not published in controller state.
