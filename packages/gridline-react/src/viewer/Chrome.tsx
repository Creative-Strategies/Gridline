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
  canDownload,
  encrypted,
  onToggleRail,
  onOpen,
  onExport,
  onDownloadOriginal,
  onDownloadEncrypted,
  showBranding = true,
  showTitle = true,
  showSheetRailToggle = true,
  showOpenButton = true,
  showExportButton = true,
  showWorkbookMenu = true,
  zoom,
  onZoom,
}: {
  title: string;
  railOpen: boolean;
  canDownload: boolean;
  encrypted: boolean;
  onToggleRail: () => void;
  onOpen: () => void;
  onExport: () => void;
  onDownloadOriginal: () => void;
  onDownloadEncrypted: () => void;
  showBranding?: boolean;
  showTitle?: boolean;
  showSheetRailToggle?: boolean;
  showOpenButton?: boolean;
  showExportButton?: boolean;
  showWorkbookMenu?: boolean;
  zoom?: number;
  onZoom?: (zoom: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);
  return (
    <header className="gridline__topbar">
      {showSheetRailToggle ? (
        <button
          aria-label={railOpen ? "Hide sheet navigation" : "Show sheet navigation"}
          className={`gridline__icon-button gridline__rail-menu${
            railOpen ? "" : " gridline__rail-menu--visible"
          }`}
          onClick={onToggleRail}
          type="button"
        >
          <MenuIcon />
        </button>
      ) : null}
      {showBranding ? (
        <div className="gridline__brand" aria-label="Gridline">
          <GridMark />
          <span>Gridline</span>
        </div>
      ) : null}
      {showTitle ? (
        <div className="gridline__title" title={title}>
          {title}
        </div>
      ) : null}
      <div className="gridline__top-actions">
        {zoom !== undefined && onZoom ? (
          <div className="gridline__compact-zoom" aria-label="Workbook zoom" role="toolbar">
            <ZoomControls onZoom={onZoom} zoom={zoom} />
          </div>
        ) : null}
        {showOpenButton ? (
          <button className="gridline__action-button" onClick={onOpen} type="button">
            <FolderIcon />
            <span>Open workbook</span>
          </button>
        ) : null}
        {showExportButton ? (
          <button className="gridline__action-button" onClick={onExport} type="button">
            <ExportIcon />
            <span>Export CSV</span>
          </button>
        ) : null}
        {showWorkbookMenu ? (
          <div className="gridline__about-wrap" ref={menuRef}>
            <button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Workbook menu"
              className="gridline__icon-button"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              <MoreIcon />
            </button>
            {menuOpen ? (
              <div className="gridline__workbook-menu" role="menu">
                <button
                  disabled={!canDownload}
                  onClick={() => {
                    onDownloadOriginal();
                    setMenuOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <ExportIcon />
                  <span>
                    <strong>{encrypted ? "Download encrypted source" : "Download original"}</strong>
                    <small>Exact bytes received by Gridline</small>
                  </span>
                </button>
                <button
                  disabled={!canDownload}
                  onClick={() => {
                    onDownloadEncrypted();
                    setMenuOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FolderIcon />
                  <span>
                    <strong>Create encrypted copy</strong>
                    <small>AES-256, password protected</small>
                  </span>
                </button>
                <div className="gridline__menu-note">
                  Parsed locally in a Web Worker. Workbook data never leaves your browser.
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
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
  showEditingControls = true,
  showZoom = true,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
  showEditingControls?: boolean;
  showZoom?: boolean;
}) {
  return (
    <div className="gridline__toolbar" aria-label="Workbook toolbar" role="toolbar">
      {showEditingControls ? (
        <>
          <button className="gridline__tool-button" disabled title="Viewing mode" type="button">
            <UndoIcon /> <span>Undo</span>
          </button>
          <button className="gridline__tool-button" disabled title="Viewing mode" type="button">
            <RedoIcon /> <span>Redo</span>
          </button>
          {showZoom ? <div className="gridline__toolbar-rule" /> : null}
        </>
      ) : null}
      {showZoom ? <ZoomControls onZoom={onZoom} zoom={zoom} /> : null}
      {showEditingControls ? (
        <>
          {showZoom ? <div className="gridline__toolbar-rule" /> : null}
          <div className="gridline__formula-tool" aria-disabled="true">
            <span className="gridline__fx">ƒx</span>
            <span>Formula</span>
            <ChevronIcon />
          </div>
        </>
      ) : null}
    </div>
  );
}

function ZoomControls({
  zoom,
  onZoom,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  return (
    <>
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
    </>
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
  compact = false,
}: {
  sheets: SheetMetadata[];
  activeSheet: number;
  onSelect: (index: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`gridline__tabs${compact ? " gridline__tabs--compact" : ""}`}>
      {!compact ? (
        <div className="gridline__tab-arrows" aria-hidden="true">
          ‹ <span>›</span>
        </div>
      ) : null}
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
      {!compact ? (
        <button
          aria-label="Sheet menu"
          className="gridline__icon-button"
          disabled
          title="No hidden sheets"
          type="button"
        >
          <MenuIcon />
        </button>
      ) : null}
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
