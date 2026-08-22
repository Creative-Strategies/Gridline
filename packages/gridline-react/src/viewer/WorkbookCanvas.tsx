import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type {
  CellCoord,
  DisplayList,
  PixelViewport,
  SheetMetadata,
} from "../engine/types";
import { paintWorkbook } from "./drawWorkbook";
import {
  COLUMN_HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
  hitTestCell,
  viewportCovers,
} from "./geometry";

type WorkbookCanvasProps = {
  activeSheet: number;
  sheet: SheetMetadata;
  selected: CellCoord;
  zoom: number;
  loadViewport: (request: PixelViewport) => Promise<DisplayList>;
  onSelect: (coord: CellCoord) => void;
  onError: (error: Error) => void;
};

type Size = { width: number; height: number };
type Scroll = { x: number; y: number };

export const WorkbookCanvas = memo(function WorkbookCanvas({
  activeSheet,
  sheet,
  selected,
  zoom,
  loadViewport,
  onSelect,
  onError,
}: WorkbookCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const [size, setSize] = useState<Size>({ width: 900, height: 520 });
  const [scroll, setScroll] = useState<Scroll>({ x: 0, y: 0 });
  const [display, setDisplay] = useState<DisplayList | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const bounds = host.getBoundingClientRect();
      const next = {
        width: Math.max(320, Math.round(bounds.width)),
        height: Math.max(240, Math.round(bounds.height)),
      };
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    scroller?.scrollTo({ left: 0, top: 0 });
    setScroll({ x: 0, y: 0 });
    setDisplay(null);
  }, [activeSheet]);

  useEffect(() => {
    let current = true;
    const viewportWidth = Math.max(1, size.width - ROW_HEADER_WIDTH);
    const viewportHeight = Math.max(1, size.height - COLUMN_HEADER_HEIGHT);
    const request = {
      sheet: activeSheet,
      scrollX: scroll.x / zoom,
      scrollY: scroll.y / zoom,
      width: viewportWidth / zoom,
      height: viewportHeight / zoom,
      overscan: 4,
    } satisfies PixelViewport;
    if (display?.sheetName === sheet.name && viewportCovers(display, request)) {
      return;
    }
    loadViewport(request)
      .then((next) => {
        if (current) setDisplay(next);
      })
      .catch((cause) => {
        if (current) onError(cause instanceof Error ? cause : new Error(String(cause)));
      });
    return () => {
      current = false;
    };
  }, [
    activeSheet,
    display,
    loadViewport,
    onError,
    scroll.x,
    scroll.y,
    sheet.name,
    size.height,
    size.width,
    zoom,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !display) return;
    paintWorkbook(canvas, display, {
      width: size.width,
      height: size.height,
      scrollX: scroll.x,
      scrollY: scroll.y,
      zoom,
      selected,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });
  }, [display, scroll.x, scroll.y, selected, size.height, size.width, zoom]);

  const handleScroll = useCallback(() => {
    if (animationRef.current !== null) return;
    animationRef.current = requestAnimationFrame(() => {
      animationRef.current = null;
      const scroller = scrollRef.current;
      if (!scroller) return;
      const next = { x: scroller.scrollLeft, y: scroller.scrollTop };
      setScroll((previous) =>
        previous.x === next.x && previous.y === next.y ? previous : next,
      );
    });
  }, []);

  useEffect(
    () => () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (!display) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const coord = hitTestCell(
        display,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        scroll.x,
        scroll.y,
        zoom,
      );
      if (coord) onSelect(coord);
      event.currentTarget.focus();
    },
    [display, onSelect, scroll.x, scroll.y, zoom],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLCanvasElement>) => {
      const deltas: Record<string, CellCoord> = {
        ArrowUp: { row: -1, column: 0 },
        ArrowDown: { row: 1, column: 0 },
        ArrowLeft: { row: 0, column: -1 },
        ArrowRight: { row: 0, column: 1 },
        Enter: { row: 1, column: 0 },
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      onSelect({
        row: Math.max(0, Math.min(1_048_575, selected.row + delta.row)),
        column: Math.max(
          0,
          Math.min(16_383, selected.column + delta.column),
        ),
      });
    },
    [onSelect, selected.column, selected.row],
  );

  const planeWidth = (display?.totalWidth ?? 2_600) * zoom + ROW_HEADER_WIDTH;
  const planeHeight =
    (display?.totalHeight ?? Math.max(2_400, sheet.rows * 24)) * zoom +
    COLUMN_HEADER_HEIGHT;

  return (
    <div className="gridline__canvas-host" ref={hostRef}>
      <div
        className="gridline__scroller"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div
          aria-hidden="true"
          className="gridline__scroll-plane"
          style={{ height: planeHeight, width: planeWidth }}
        />
        <canvas
          aria-colcount={sheet.columns}
          aria-label={`${sheet.name} worksheet. Use arrow keys to move between cells.`}
          aria-rowcount={sheet.rows}
          className="gridline__canvas"
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          ref={canvasRef}
          role="grid"
          style={{ transform: `translate(${scroll.x}px, ${scroll.y}px)` }}
          tabIndex={0}
        />
      </div>
      {display ? null : (
        <div className="gridline__canvas-loading" role="status">
          <span /> Rendering worksheet…
        </div>
      )}
      <span className="gridline__sr-only" aria-live="polite">
        Selected row {selected.row + 1}, column {selected.column + 1}
      </span>
    </div>
  );
});
