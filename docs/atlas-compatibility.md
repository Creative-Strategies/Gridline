# Atlas workbook compatibility

This note records the OOXML structures observed in
Atlas_AI_Factory_Economics_Model_Service_V1.xlsx and the Gridline ingestion
behavior for them. Workbook cell text is treated as data; none of the text in
the workbook is interpreted as an instruction to the renderer or formula
engine.

## Package inventory

The workbook is a small OOXML package: 368,117 uncompressed bytes across 45
parts. It contains 13 worksheets, xl/styles.xml, a theme, one shared-string
part, seven table parts, three PNG image parts, two drawing parts, one chart
part, core package relationships, and a persons/person.xml part. The sheet
names are:

Cover, Dashboard, Control, Integration_Readme, Research_Inbox,
Source_Evidence, Data_Dictionary, Assumptions, Capacity_Engine,
Economics_Engine, Atlas_Output_Long, Change_Log, and Checks.

The workbook uses the default 1900 date system (no date1904 workbook
property). Each worksheet stores explicit cols and sheetFormatPr
defaultRowHeight="15" metadata, but does not include a dimension element.
Gridline derives bounds from populated cells when the dimension is omitted.

## Observed worksheet structures

Across the 13 sheets there are 3,084 stored cell records, 216 formulas, 48
merged ranges, and no frozen panes. The sheets omit sheetView overrides, so
Excel's default visible gridlines apply. Gridline also honors explicit
showGridLines="0" views and frozen row/column panes in other workbooks. Column spans use widths from 4 to 75
Excel-width units; row records use explicit heights on the title/header rows.
Cells use t="str" for literal strings, t="n" for numbers, and formula
cells commonly carry a cached <v> value alongside <f>. The parser preserves
both the formula and cached result, which keeps a workbook view useful even
when a formula is outside the supported evaluation subset.

The formulas exercise:

- quoted cross-sheet references such as 'Control'!$B$8;
- same-sheet arithmetic and ranges;
- nested IF;
- ABS, COUNTIF, COUNTIFS, COUNTA, and COUNTBLANK.

Formula evaluation is intentionally handled by the separate bounded formula
engine. OOXML ingestion does not execute workbook text, links, macros, or
external relationships.

## Styles and number formats

styles.xml contains 13 fonts, 14 fills, 2 borders, 51 cell formats, and four
custom number formats:

- 200: yyyy-mm-dd
- 201: 0.00
- 202: 0.0%
- 203: 0.00000

Atlas uses prefixed XML namespaces (x:) and ARGB rgb colors such as
FFF26522; the parser matches local names and converts ARGB values to
six-digit CSS colors. Solid fills, font family/size/weight/italic state,
border edges/colors, vertical/horizontal alignment, and wrapping are carried
into the sparse workbook style model. Date rendering now honors custom token
order, including the Atlas yyyy-mm-dd format.

## Drawings, charts, images, and tables

The Cover sheet has two anchored PNG images. Dashboard has one PNG image and a
two-cell chart anchor from A18 through I36. Its chart is stored at
xl/drawings/charts/chart1.xml, with series references to
'Dashboard'!$A$16:$A$20, $B$16:$B$20, and $C$16:$C$20.

Gridline now follows worksheet drawing relationships, resolves the nested
xl/drawings/charts target, parses the first chart series' title/category/value
references, and maps the cached worksheet cells into the existing ChartSpec
model. Two-cell anchor geometry is converted from worksheet column/row spans
to pixels. The model intentionally exposes one point series, so additional
series in a chart are not represented. PNG images remain deferred: their
relationship and binary parts are preserved in the input package but are not
decoded into the canvas display list.

Table parts are recognized as ordinary worksheet cell content through their
sheet XML; table metadata, structured references, filters, and totals-row
semantics are not yet surfaced by the sparse model. Comments, threaded
comments, persons, conditional formatting, data validation, hyperlinks,
defined names, and page layout metadata are likewise deferred.

## Safety and limits

The package remains subject to Gridline's archive, expanded-size, part-size,
sheet-count, and populated-cell limits. External relationship targets are
skipped or rejected, and relationship path traversal outside the package is
rejected. Malformed optional drawing/chart parts do not change the core cell
ingestion contract; only supported, bounded chart references are attached to a
worksheet.
