# gridline-wasm

Gridline WASM contains the generated browser bindings and WebAssembly binary
for Gridline's from-scratch Rust OOXML workbook engine.

Most applications should install
[gridline-viewer](https://www.npmjs.com/package/gridline-viewer), which depends
on this package and supplies the React surface, worker lifecycle, source
loading, encryption, and Next.js configuration helper.

The engine is read-only and local-first. It parses workbook relationships,
worksheets, shared strings, styles, number formats, merged cells, frozen panes,
bounded formulas, charts, and sparse viewport display lists without embedding
a third-party spreadsheet engine.

Source and security documentation:
[Creative-Strategies/Gridline](https://github.com/Creative-Strategies/Gridline).

