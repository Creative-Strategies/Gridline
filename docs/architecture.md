# Gridline architecture

## Design goal

Gridline is an embeddable read-only workbook surface, not a browser office suite. Its first release optimizes for safe local viewing, fidelity for common `.xlsx` workbooks, deterministic rendering, and smooth navigation through large sparse sheets.

The engine is “from scratch” at the spreadsheet layer: Gridline owns the workbook model, OOXML relationship traversal, worksheet semantics, style resolution, number formatting, simple formula evaluation, viewport layout, and canvas renderer. It uses small commodity crates only for ZIP decompression, XML tokenization, and JavaScript bindings; it does not wrap SheetJS, ExcelJS, Handsontable, Luckysheet, Univer, or Microsoft Office components.

## Data flow

1. The browser transfers an `.xlsx` `ArrayBuffer` to a module worker.
2. Rust/WASM opens the OOXML ZIP container and resolves workbook relationships.
3. The core builds a sparse workbook model with shared styles and strings.
4. React requests a row/column window based on scroll position.
5. WASM returns a compact display list with geometry, formatted text, and resolved paint tokens.
6. The React canvas renderer paints the display list at device-pixel resolution and keeps DOM overlays only for interaction and accessibility.

## Package boundaries

- `gridline-core` has no React or Next.js dependency and can be tested natively.
- `@gridline/react` owns worker lifecycle, scrolling, selection, file input, and canvas painting.
- `@gridline/demo` proves App Router integration without server-side WASM execution.

## Supported OOXML surface

- Workbook/sheet relationships and visibility.
- Shared strings, inline strings, booleans, numbers, errors, formulas, and cached formula values.
- Fonts, solid fills, borders, alignments, built-in/custom number formats, row heights, and column widths.
- Merged cells and frozen panes.
- Sparse, virtualized viewport extraction, address lookup, text search, and CSV export.
- Formula primitives for arithmetic and `SUM`, `AVERAGE`, `MIN`, `MAX`, and `COUNT` when a cached value is unavailable.

Deliberately deferred: editing and save-back, macros, external links, pivot tables, conditional-format rules, images/drawings, and native Excel chart rendering. Unsupported objects are ignored without preventing the sheet grid from loading.

## Security and resource limits

Parsing stays in a worker. The core rejects oversized archives, excessive expanded XML, too many sheets/cells, invalid relationship targets, and malformed coordinates. Formulas are interpreted as data by a small evaluator; they are never executed as JavaScript.

