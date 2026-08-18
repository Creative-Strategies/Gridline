# Gridline interface specification

The source concept is `work/design/gridline-concept.png`.

## Visual system

- True-white spreadsheet canvas (`#ffffff`) on pale cool-gray chrome (`#f6f8fa`).
- Charcoal content (`#171b21`), secondary slate (`#66707b`), hairline grid/borders (`#d9e0e6`).
- Saturated emerald primary (`#08783e`) with a pale selected surface (`#e7f3ec`).
- Restrained blue (`#2f5db5`) only for worksheet link/section accents.
- Inter/SF-style sans UI and tabular figures. Controls use deliberate 13–14px type; cells use 13px.
- Square to 6px corners, 1px borders, almost no elevation, no gradients or glass effects.

## Layout contract

- 56px title bar, 48px command bar, 46px formula bar.
- 224px collapsible sheet rail.
- Dominant canvas with 44px row header and 112px default columns.
- 48px sheet tab bar and 36px status bar.
- Canvas remains the focal surface at every breakpoint; the rail collapses below 900px.

## Visible copy lock

Above the fold: `Gridline`, `FY26 Operating Plan.xlsx`, `Open workbook`, `Export CSV`, `Undo`, `Redo`, `100%`, `Formula`, `C8`, `=SUM(C4:C7)`, `Sheets`, `Executive Summary`, `Revenue Plan`, `Headcount`, `Assumptions`, `4 sheets · 2,418 cells`, `C8 · Sum: $4.82M`, `Local · WASM`.

## Component inventory

- Quiet product mark and document title.
- Outline-icon command buttons and file actions.
- Name box and formula input.
- Collapsible sheet navigation rail.
- Device-pixel canvas, virtual scroll plane, row/column headers, selection overlay, and frozen dividers.
- Sheet tabs, workbook status, selection summary, and local/WASM status.

All copy and controls are code-native. The concept is not used as a shipped raster asset.

