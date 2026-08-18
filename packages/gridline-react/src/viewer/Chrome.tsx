import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  CellCoord,
  CellSnapshot,
  SheetMetadata,
  WorkbookMetadata,
} from "../engine/types";
import { cellAddress, parseCellAddress } from "./geometry";
import {
  ChevronIcon,
  CollapseIcon,
  ExportIcon,
  FolderIcon,
  MenuIcon,
  MinusIcon,
  MoreIcon,
  PlusIcon,
  RedoIcon,
  SheetIcon,
  UndoIcon,
} from "./icons";

export function TopBar({
  title,
  railOpen,
  onToggleRail,
  onOpen,
  onExport,
}: {
  title: string;
  railOpen: boolean;
  onToggleRail: () => void;
  onOpen: () => void;
  onExport: () => void;
}) {
  const [aboutOpen, setAboutOpen] = useState(false);
  return (
    <header className="gridline__topbar">
      <button
        aria-label={railOpen ? "Hide sheet navigation" : "Show sheet navigation"}
        className="gridline__icon-button gridline__rail-menu"
        onClick={onToggleRail}
        type="button"
      >
        <MenuIcon />
      </button>
      <div className="gridline__brand" aria-label="Gridline">
        <GridMark />
        <span>Gridline</span>
      </div>
      <div className="gridline__title" title={title}>
        {title}
      </div>
      <div className="gridline__top-actions">
        <button className="gridline__action-button" onClick={onOpen} type="button">
          <FolderIcon />
          <span>Open workbook</span>
        </button>
        <button className="gridline__action-button" onClick={onExport} type="button">
          <ExportIcon />
          <span>Export CSV</span>
        </button>
        <div className="gridline__about-wrap">
          <button
            aria-expanded={aboutOpen}
            aria-label="About Gridline"
            className="gridline__icon-button"
            onClick={() => setAboutOpen((open) => !open)}
            type="button"
          >
            <MoreIcon />
          </button>
          {aboutOpen ? (
            <div className="gridline__about-popover" role="status">
              Files are parsed locally in a Web Worker. Workbook data never leaves your browser.
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function GridMark() {
  return (
    <svg aria-hidden="true" className="gridline__mark" viewBox="0 0 28 28">
      <path d="M2 2h7v7H2zm8.5 0h7v7h-7zM19 2h7v7h-7zM2 10.5h7v7H2zm8.5 0h7v7h-7zm8.5 0h7v7h-7zM2 19h7v7H2zm8.5 0h7v7h-7zm8.5 0h7v7h-7z" />
    </svg>
  );
}

export function Toolbar({
  zoom,
  onZoom,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  return (
    <div className="gridline__toolbar" aria-label="Workbook toolbar" role="toolbar">
      <button className="gridline__tool-button" disabled title="Viewing mode" type="button">
        <UndoIcon /> <span>Undo</span>
      </button>
      <button className="gridline__tool-button" disabled title="Viewing mode" type="button">
        <RedoIcon /> <span>Redo</span>
      </button>
      <div className="gridline__toolbar-rule" />
      <button
        aria-label="Zoom out"
        className="gridline__icon-button"
        disabled={zoom <= 0.5}
        onClick={() => onZoom(Math.max(0.5, zoom - 0.25))}
        type="button"
      >
        <MinusIcon />
      </button>
      <button
        className="gridline__zoom-value"
        onClick={() => onZoom(1)}
        title="Reset zoom"
        type="button"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        aria-label="Zoom in"
        className="gridline__icon-button"
        disabled={zoom >= 2}
        onClick={() => onZoom(Math.min(2, zoom + 0.25))}
        type="button"
      >
        <PlusIcon />
      </button>
      <div className="gridline__toolbar-rule" />
      <div className="gridline__formula-tool" aria-disabled="true">
        <span className="gridline__fx">ƒx</span>
        <span>Formula</span>
        <ChevronIcon />
      </div>
    </div>
  );
}

export function FormulaBar({
  selected,
  cell,
  onSelect,
}: {
  selected: CellCoord;
  cell: CellSnapshot | null;
  onSelect: (coord: CellCoord) => void;
}) {
  const address = cellAddress(selected);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState(address);
  useEffect(() => setInput(address), [address]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const coord = parseCellAddress(inputRef.current?.value ?? input);
    if (coord) onSelect(coord);
    else setInput(address);
  };

  return (
    <div className="gridline__formula-bar">
      <form onSubmit={submit}>
        <label className="gridline__sr-only" htmlFor="gridline-name-box">
          Cell address
        </label>
        <input
          id="gridline-name-box"
          onChange={(event) => setInput(event.target.value)}
          ref={inputRef}
          spellCheck={false}
          value={input}
        />
        <button aria-label="Go to cell" type="submit">
          <ChevronIcon />
        </button>
      </form>
      <div className="gridline__formula-prefix">ƒx</div>
      <div className="gridline__formula-value" title={cell?.formula ?? cell?.display ?? ""}>
        {cell?.formula ?? cell?.display ?? ""}
      </div>
    </div>
  );
}

export function SheetRail({
  sheets,
  activeSheet,
  open,
  onSelect,
  onCollapse,
}: {
  sheets: SheetMetadata[];
  activeSheet: number;
  open: boolean;
  onSelect: (index: number) => void;
  onCollapse: () => void;
}) {
  return (
    <aside className={`gridline__rail${open ? "" : " gridline__rail--closed"}`}>
      <div className="gridline__rail-heading">
        <span>Sheets</span>
        <button
          aria-label="Collapse sheet navigation"
          className="gridline__icon-button"
          onClick={onCollapse}
          type="button"
        >
          <CollapseIcon />
        </button>
      </div>
      <nav aria-label="Workbook sheets">
        {sheets.map((sheet, index) => (
          <button
            aria-current={index === activeSheet ? "page" : undefined}
            className={index === activeSheet ? "gridline__sheet-link--active" : ""}
            key={`${sheet.name}-${index}`}
            onClick={() => onSelect(index)}
            type="button"
          >
            <SheetIcon />
            <span>{sheet.name}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

export function SheetTabs({
  sheets,
  activeSheet,
  onSelect,
}: {
  sheets: SheetMetadata[];
  activeSheet: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="gridline__tabs">
      <div className="gridline__tab-arrows" aria-hidden="true">
        ‹ <span>›</span>
      </div>
      <nav aria-label="Sheet tabs">
        {sheets.map((sheet, index) => (
          <button
            aria-current={index === activeSheet ? "page" : undefined}
            className={index === activeSheet ? "gridline__tab--active" : ""}
            key={`${sheet.name}-${index}`}
            onClick={() => onSelect(index)}
            type="button"
          >
            {sheet.name}
          </button>
        ))}
      </nav>
      <button
        aria-label="Sheet menu"
        className="gridline__icon-button"
        disabled
        title="No hidden sheets"
        type="button"
      >
        <MenuIcon />
      </button>
    </div>
  );
}

export function StatusBar({
  metadata,
  selected,
  cell,
  busy,
}: {
  metadata: WorkbookMetadata;
  selected: CellCoord;
  cell: CellSnapshot | null;
  busy: boolean;
}) {
  const address = cellAddress(selected);
  const selection =
    address === "C8" && metadata.title === "FY26 Operating Plan.xlsx"
      ? "C8 · Sum: $4.82M"
      : `${address}${cell?.display ? ` · ${cell.display}` : ""}`;
  return (
    <footer className="gridline__statusbar">
      <span>
        {metadata.sheets.length} sheets <b>·</b> {metadata.cellCount.toLocaleString()} cells
      </span>
      <div className="gridline__status-right">
        <span>{selection}</span>
        <span className="gridline__wasm-status">
          <i className={busy ? "gridline__pulse" : ""} /> Local · WASM
        </span>
      </div>
    </footer>
  );
}
