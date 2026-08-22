import type {
  AxisMetric,
  CellCoord,
  CellStyle,
  CellValue,
  DisplayChart,
  DisplayList,
} from "../engine/types";
import {
  COLUMN_HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
  frozenPaneSize,
} from "./geometry";

type PaintOptions = {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
  selected: CellCoord;
  devicePixelRatio: number;
};

type PaintPane = {
  rowFrozen: boolean;
  columnFrozen: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  cover: boolean;
};

type FrozenPaneMetrics = { width: number; height: number };

// Canvas text is attacker-controlled workbook data. Keep layout work and the
// string handed to fillText bounded on the main thread while allowing normal
// long financial labels to render unchanged.
export const MAX_CANVAS_TEXT_CHARACTERS = 16_384;
export const MAX_TEXT_MEASUREMENTS = 8_192;
export const MAX_TEXT_LINES = 4_096;

const colors = {
  canvas: "#ffffff",
  chrome: "#f6f8fa",
  grid: "#d9e0e6",
  text: "#171b21",
  muted: "#66707b",
  green: "#08783e",
  greenSoft: "#e7f3ec",
};

export function paintWorkbook(
  canvas: HTMLCanvasElement,
  display: DisplayList,
  options: PaintOptions,
) {
  const { width, height, devicePixelRatio: ratio } = options;
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const cssWidth = `${width}px`;
  const cssHeight = `${height}px`;
  if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
  if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = colors.canvas;
  context.fillRect(0, 0, width, height);

  const frozen = frozenPaneSize(display, options.zoom);
  const splitX = Math.min(width, ROW_HEADER_WIDTH + frozen.width);
  const splitY = Math.min(height, COLUMN_HEADER_HEIGHT + frozen.height);
  paintPane(context, display, options, {
    rowFrozen: false,
    columnFrozen: false,
    x: splitX,
    y: splitY,
    width: width - splitX,
    height: height - splitY,
    cover: false,
  });
  if (frozen.height > 0) {
    paintPane(context, display, options, {
      rowFrozen: true,
      columnFrozen: false,
      x: splitX,
      y: COLUMN_HEADER_HEIGHT,
      width: width - splitX,
      height: frozen.height,
      cover: true,
    });
  }
  if (frozen.width > 0) {
    paintPane(context, display, options, {
      rowFrozen: false,
      columnFrozen: true,
      x: ROW_HEADER_WIDTH,
      y: splitY,
      width: frozen.width,
      height: height - splitY,
      cover: true,
    });
  }
  if (frozen.width > 0 && frozen.height > 0) {
    paintPane(context, display, options, {
      rowFrozen: true,
      columnFrozen: true,
      x: ROW_HEADER_WIDTH,
      y: COLUMN_HEADER_HEIGHT,
      width: frozen.width,
      height: frozen.height,
      cover: true,
    });
  }
  paintCharts(context, display, options);
  paintHeaders(context, display, options);
}

function paintPane(
  context: CanvasRenderingContext2D,
  display: DisplayList,
  options: PaintOptions,
  pane: PaintPane,
) {
  if (pane.width <= 0 || pane.height <= 0) return;
  context.save();
  context.beginPath();
  context.rect(pane.x, pane.y, pane.width, pane.height);
  context.clip();
  if (pane.cover) {
    context.fillStyle = colors.canvas;
    context.fillRect(pane.x, pane.y, pane.width, pane.height);
  }
  if (display.showGridLines) paintGrid(context, display, options, pane);
  const frozen = frozenPaneSize(display, 1);
  paintCells(context, display, options, pane, frozen);
  paintSelection(context, display, options, pane, frozen);
  context.restore();
}

function screenX(metric: AxisMetric, display: DisplayList, options: PaintOptions) {
  return (
    ROW_HEADER_WIDTH +
    (display.originX + metric.offset) * options.zoom -
    (metric.index < display.freeze.columns ? 0 : options.scrollX)
  );
}

function screenY(metric: AxisMetric, display: DisplayList, options: PaintOptions) {
  return (
    COLUMN_HEADER_HEIGHT +
    (display.originY + metric.offset) * options.zoom -
    (metric.index < display.freeze.rows ? 0 : options.scrollY)
  );
}

function belongsToPane(
  row: number,
  column: number,
  display: DisplayList,
  pane: PaintPane,
) {
  return (
    (row < display.freeze.rows) === pane.rowFrozen &&
    (column < display.freeze.columns) === pane.columnFrozen
  );
}

function cellIntersectsPane(
  cell: DisplayList["cells"][number],
  display: DisplayList,
  pane: PaintPane,
  frozen: FrozenPaneMetrics,
) {
  const x = display.originX + cell.x;
  const y = display.originY + cell.y;
  const intersectsColumns = pane.columnFrozen
    ? x < frozen.width
    : x + cell.width > frozen.width;
  const intersectsRows = pane.rowFrozen
    ? y < frozen.height
    : y + cell.height > frozen.height;
  return intersectsColumns && intersectsRows;
}

function paintGrid(
  context: CanvasRenderingContext2D,
  display: DisplayList,
  options: PaintOptions,
  pane: PaintPane,
) {
  context.strokeStyle = colors.grid;
  context.lineWidth = 1;
  context.beginPath();
  let lastColumn: AxisMetric | undefined;
  for (const column of display.columns) {
    if ((column.index < display.freeze.columns) !== pane.columnFrozen) continue;
    const x = crisp(screenX(column, display, options));
    context.moveTo(x, pane.y);
    context.lineTo(x, pane.y + pane.height);
    lastColumn = column;
  }
  if (lastColumn) {
    const x = crisp(
      screenX(lastColumn, display, options) + lastColumn.size * options.zoom,
    );
    context.moveTo(x, pane.y);
    context.lineTo(x, pane.y + pane.height);
  }
  let lastRow: AxisMetric | undefined;
  for (const row of display.rows) {
    if ((row.index < display.freeze.rows) !== pane.rowFrozen) continue;
    const y = crisp(screenY(row, display, options));
    context.moveTo(pane.x, y);
    context.lineTo(pane.x + pane.width, y);
    lastRow = row;
  }
  if (lastRow) {
    const y = crisp(
      screenY(lastRow, display, options) + lastRow.size * options.zoom,
    );
    context.moveTo(pane.x, y);
    context.lineTo(pane.x + pane.width, y);
  }
  context.stroke();
}

function paintCells(
  context: CanvasRenderingContext2D,
  display: DisplayList,
  options: PaintOptions,
  pane: PaintPane,
  frozen: FrozenPaneMetrics,
) {
  for (const cell of display.cells) {
    if (!cellIntersectsPane(cell, display, pane, frozen)) continue;
    const style = display.styles[cell.styleId] ?? display.styles[0];
    const x =
      ROW_HEADER_WIDTH +
      (display.originX + cell.x) * options.zoom -
      (pane.columnFrozen ? 0 : options.scrollX);
    const y =
      COLUMN_HEADER_HEIGHT +
      (display.originY + cell.y) * options.zoom -
      (pane.rowFrozen ? 0 : options.scrollY);
    const width = cell.width * options.zoom;
    const height = cell.height * options.zoom;
    if (style.fill || cell.merged) {
      context.fillStyle = style.fill ?? colors.canvas;
      context.fillRect(x + 0.5, y + 0.5, width - 1, height - 1);
    }
    paintText(context, cell.text, cell.value, style, x, y, width, height, options.zoom);
    paintBorders(context, style, x, y, width, height);
  }
}

function paintText(
  context: CanvasRenderingContext2D,
  text: string,
  value: CellValue,
  style: CellStyle,
  x: number,
  y: number,
  width: number,
  height: number,
  zoom: number,
) {
  if (!text) return;
  const boundedText =
    text.length > MAX_CANVAS_TEXT_CHARACTERS
      ? `${text.slice(0, MAX_CANVAS_TEXT_CHARACTERS - 1)}…`
      : text;
  const fontSize = Math.max(8, style.font.size * zoom);
  context.font = `${style.font.italic ? "italic " : ""}${style.font.bold ? "600 " : "400 "}${fontSize}px ${style.font.family || "Arial"}, sans-serif`;
  context.fillStyle = style.font.color ?? colors.text;
  const numeric = value.kind === "number";
  const alignment = style.alignment.horizontal ?? (numeric ? "right" : "left");
  context.textAlign = alignment === "center" ? "center" : alignment === "right" ? "right" : "left";
  const padding = Math.max(5, 8 * zoom);
  const textX =
    alignment === "center" ? x + width / 2 : alignment === "right" ? x + width - padding : x + padding;
  const lineHeight = Math.max(11, fontSize * 1.2);
  const maxLines = style.alignment.wrapText
    ? Math.max(1, Math.floor((height - padding) / lineHeight))
    : 1;
  const lines = style.alignment.wrapText
    ? wrapText(
        boundedText,
        Math.max(1, width - padding * 2),
        (line) => context.measureText(line).width,
        maxLines,
      )
    : [boundedText];
  const blockHeight = lines.length * lineHeight;
  const vertical = style.alignment.vertical?.toLowerCase();
  const firstBaseline =
    vertical === "top"
      ? y + Math.max(fontSize, padding)
      : vertical === "bottom"
        ? y + height - Math.max(2, padding / 2) - blockHeight + fontSize
        : y + (height - blockHeight) / 2 + fontSize;
  context.save();
  context.beginPath();
  context.rect(x + 2, y + 1, Math.max(0, width - 4), Math.max(0, height - 2));
  context.clip();
  context.textBaseline = "alphabetic";
  lines.forEach((line, index) => {
    context.fillText(line, textX, firstBaseline + index * lineHeight);
  });
  context.restore();
}

/**
 * Wraps cell text without creating DOM nodes. Spreadsheet cells are often
 * long labels with an explicit wrap flag, and drawing the full string as one
 * line makes those labels disappear behind the next cell. The callback keeps
 * this helper independent from Canvas so its layout policy remains testable.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
  maxLines = Number.POSITIVE_INFINITY,
) {
  if (!text || maxWidth <= 0 || maxLines < 1) return [];
  const boundedText = text.slice(0, MAX_CANVAS_TEXT_CHARACTERS);
  const lines: string[] = [];
  const paragraphs = boundedText.split(/\r?\n/);
  let truncated = boundedText.length < text.length;
  let measurementCount = 0;
  const lineLimit = Math.min(maxLines, MAX_TEXT_LINES);

  const measureLine = (line: string) => {
    if (measurementCount >= MAX_TEXT_MEASUREMENTS) {
      truncated = true;
      return undefined;
    }
    measurementCount += 1;
    const measured = measure(line);
    if (!Number.isFinite(measured)) {
      truncated = true;
      return undefined;
    }
    return measured;
  };

  const pushLine = (line: string) => {
    if (lines.length >= lineLimit) {
      truncated = true;
      return false;
    }
    lines.push(line);
    return true;
  };

  const splitWord = (word: string) => {
    const chunks: string[] = [];
    let remainder = word;
    while (remainder) {
      const remainderWidth = measureLine(remainder);
      if (remainderWidth === undefined) return chunks.length ? chunks : undefined;
      if (remainderWidth <= maxWidth || remainder.length === 1) {
        chunks.push(remainder);
        return chunks;
      }

      // Binary search the largest prefix that fits. This avoids the
      // quadratic character-by-character scan that a hostile unbroken token
      // would otherwise trigger.
      let low = 1;
      let high = remainder.length - 1;
      let best = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const width = measureLine(remainder.slice(0, middle));
        if (width === undefined) return chunks.length ? chunks : undefined;
        if (width <= maxWidth) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      // Preserve the previous behavior for a single glyph wider than the
      // cell: it is still emitted and clipped by the canvas pane.
      const split = best || 1;
      chunks.push(remainder.slice(0, split));
      remainder = remainder.slice(split);
    }
    return chunks;
  };

  for (const paragraph of paragraphs) {
    if (lines.length >= lineLimit) break;
    if (!paragraph.trim()) {
      pushLine("");
      continue;
    }
    let current = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const chunks = splitWord(word);
      if (!chunks) {
        if (current) pushLine(current);
        current = "";
        break;
      }
      for (const chunk of chunks) {
        const candidate = current ? `${current} ${chunk}` : chunk;
        const candidateWidth = current ? measureLine(candidate) : 0;
        if (!current || (candidateWidth !== undefined && candidateWidth <= maxWidth)) {
          current = candidate;
          continue;
        }
        if (!pushLine(current)) break;
        current = chunk;
      }
      if (lines.length >= lineLimit || measurementCount >= MAX_TEXT_MEASUREMENTS) break;
    }
    if (lines.length < lineLimit && current) pushLine(current);
  }

  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (last) {
      const width = measureLine(`${last}…`);
      if (width === undefined || width <= maxWidth) break;
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function paintBorders(
  context: CanvasRenderingContext2D,
  style: CellStyle,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const edges = [
    [style.border.top, x, y, x + width, y],
    [style.border.right, x + width, y, x + width, y + height],
    [style.border.bottom, x, y + height, x + width, y + height],
    [style.border.left, x, y, x, y + height],
  ] as const;
  for (const [edge, startX, startY, endX, endY] of edges) {
    if (!edge.style) continue;
    context.strokeStyle = edge.color ?? colors.grid;
    context.lineWidth = edge.style.includes("thick") ? 2 : 1;
    context.beginPath();
    context.moveTo(crisp(startX), crisp(startY));
    context.lineTo(crisp(endX), crisp(endY));
    context.stroke();
  }
}

function paintCharts(
  context: CanvasRenderingContext2D,
  display: DisplayList,
  options: PaintOptions,
) {
  context.save();
  context.beginPath();
  context.rect(
    ROW_HEADER_WIDTH,
    COLUMN_HEADER_HEIGHT,
    options.width - ROW_HEADER_WIDTH,
    options.height - COLUMN_HEADER_HEIGHT,
  );
  context.clip();
  for (const chart of display.charts) {
    paintChart(context, chart, display, options);
  }
  context.restore();
}

function paintChart(
  context: CanvasRenderingContext2D,
  chart: DisplayChart,
  display: DisplayList,
  options: PaintOptions,
) {
  const x =
    ROW_HEADER_WIDTH +
    (display.originX + chart.x) * options.zoom -
    (chart.column < display.freeze.columns ? 0 : options.scrollX);
  const y =
    COLUMN_HEADER_HEIGHT +
    (display.originY + chart.y) * options.zoom -
    (chart.row < display.freeze.rows ? 0 : options.scrollY);
  const width = chart.width * options.zoom;
  const height = chart.height * options.zoom;
  context.fillStyle = colors.canvas;
  context.fillRect(x, y, width, height);
  context.strokeStyle = colors.grid;
  context.lineWidth = 1;
  context.strokeRect(crisp(x), crisp(y), width, height);
  context.fillStyle = colors.text;
  context.font = `600 ${13 * options.zoom}px Inter, sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText(chart.title, x + 18 * options.zoom, y + 28 * options.zoom);
  context.fillStyle = colors.muted;
  context.font = `400 ${10 * options.zoom}px Inter, sans-serif`;
  context.fillText(chart.subtitle, x + 18 * options.zoom, y + 47 * options.zoom);
  const plotX = x + 48 * options.zoom;
  const plotY = y + 70 * options.zoom;
  const plotWidth = width - 65 * options.zoom;
  const plotHeight = height - 98 * options.zoom;
  context.strokeStyle = "#aeb7c0";
  context.beginPath();
  context.moveTo(plotX, plotY);
  context.lineTo(plotX, plotY + plotHeight);
  context.lineTo(plotX + plotWidth, plotY + plotHeight);
  context.stroke();
  const maximum = Math.max(...chart.points.map((point) => point.value), 1);
  const slot = plotWidth / Math.max(chart.points.length, 1);
  chart.points.forEach((point, index) => {
    const barWidth = slot * 0.46;
    const barHeight = (point.value / maximum) * plotHeight * 0.82;
    const barX = plotX + slot * index + (slot - barWidth) / 2;
    const barY = plotY + plotHeight - barHeight;
    context.fillStyle = colors.green;
    context.fillRect(barX, barY, barWidth, barHeight);
    context.fillStyle = colors.text;
    context.font = `400 ${9 * options.zoom}px Inter, sans-serif`;
    context.textAlign = "center";
    context.fillText(`$${point.value.toFixed(2)}M`, barX + barWidth / 2, barY - 6 * options.zoom);
    context.fillStyle = colors.muted;
    context.fillText(point.label, barX + barWidth / 2, plotY + plotHeight + 16 * options.zoom);
  });
}

function paintSelection(
  context: CanvasRenderingContext2D,
  display: DisplayList,
  options: PaintOptions,
  pane: PaintPane,
  frozen: FrozenPaneMetrics,
) {
  const column = display.columns.find((metric) => metric.index === options.selected.column);
  const row = display.rows.find((metric) => metric.index === options.selected.row);
  if (!column || !row) return;
  const selectedCell = display.cells.find(
    (cell) => cell.row === options.selected.row && cell.column === options.selected.column,
  );
  if (
    selectedCell
      ? !cellIntersectsPane(selectedCell, display, pane, frozen)
      : !belongsToPane(
          options.selected.row,
          options.selected.column,
          display,
          pane,
        )
  ) {
    return;
  }
  const x =
    ROW_HEADER_WIDTH +
    (display.originX + column.offset) * options.zoom -
    (pane.columnFrozen ? 0 : options.scrollX);
  const y =
    COLUMN_HEADER_HEIGHT +
    (display.originY + row.offset) * options.zoom -
    (pane.rowFrozen ? 0 : options.scrollY);
  const width = (selectedCell?.width ?? column.size) * options.zoom;
  const height = (selectedCell?.height ?? row.size) * options.zoom;
  context.strokeStyle = colors.green;
  context.lineWidth = 2;
  context.strokeRect(crisp(x), crisp(y), Math.max(1, width), Math.max(1, height));
  context.fillStyle = colors.green;
  context.fillRect(x + width - 4, y + height - 4, 7, 7);
}

function paintHeaders(
  context: CanvasRenderingContext2D,
  display: DisplayList,
  options: PaintOptions,
) {
  const frozen = frozenPaneSize(display, options.zoom);
  const splitX = Math.min(options.width, ROW_HEADER_WIDTH + frozen.width);
  const splitY = Math.min(options.height, COLUMN_HEADER_HEIGHT + frozen.height);
  context.fillStyle = colors.chrome;
  context.fillRect(0, 0, options.width, COLUMN_HEADER_HEIGHT);
  context.fillRect(0, 0, ROW_HEADER_WIDTH, options.height);
  context.font = "500 12px Inter, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  paintColumnHeaders(
    context,
    display,
    options,
    false,
    splitX,
    Math.max(0, options.width - splitX),
  );
  if (frozen.width > 0) {
    paintColumnHeaders(
      context,
      display,
      options,
      true,
      ROW_HEADER_WIDTH,
      frozen.width,
    );
  }
  paintRowHeaders(
    context,
    display,
    options,
    false,
    splitY,
    Math.max(0, options.height - splitY),
  );
  if (frozen.height > 0) {
    paintRowHeaders(
      context,
      display,
      options,
      true,
      COLUMN_HEADER_HEIGHT,
      frozen.height,
    );
  }
  context.fillStyle = colors.chrome;
  context.fillRect(0, 0, ROW_HEADER_WIDTH, COLUMN_HEADER_HEIGHT);
  context.strokeStyle = colors.grid;
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, ROW_HEADER_WIDTH, COLUMN_HEADER_HEIGHT);
  context.fillStyle = "#d5dce2";
  context.beginPath();
  context.moveTo(ROW_HEADER_WIDTH - 6, 7);
  context.lineTo(ROW_HEADER_WIDTH - 6, COLUMN_HEADER_HEIGHT - 6);
  context.lineTo(ROW_HEADER_WIDTH - 22, COLUMN_HEADER_HEIGHT - 6);
  context.closePath();
  context.fill();

  if (frozen.width > 0) {
    context.strokeStyle = "#aeb7c0";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(crisp(splitX), COLUMN_HEADER_HEIGHT);
    context.lineTo(crisp(splitX), options.height);
    context.stroke();
  }
  if (frozen.height > 0) {
    context.strokeStyle = "#aeb7c0";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(ROW_HEADER_WIDTH, crisp(splitY));
    context.lineTo(options.width, crisp(splitY));
    context.stroke();
  }
}

function paintColumnHeaders(
  context: CanvasRenderingContext2D,
  display: DisplayList,
  options: PaintOptions,
  frozen: boolean,
  clipX: number,
  clipWidth: number,
) {
  if (clipWidth <= 0) return;
  context.save();
  context.beginPath();
  context.rect(clipX, 0, clipWidth, COLUMN_HEADER_HEIGHT);
  context.clip();
  context.fillStyle = colors.chrome;
  context.fillRect(clipX, 0, clipWidth, COLUMN_HEADER_HEIGHT);
  for (const column of display.columns) {
    if ((column.index < display.freeze.columns) !== frozen) continue;
    const x = screenX(column, display, options);
    const width = column.size * options.zoom;
    if (column.index === options.selected.column) {
      context.fillStyle = colors.greenSoft;
      context.fillRect(x, 0, width, COLUMN_HEADER_HEIGHT);
      context.fillStyle = colors.green;
      context.fillRect(x, COLUMN_HEADER_HEIGHT - 2, width, 2);
    }
    context.fillStyle = column.index === options.selected.column ? colors.green : colors.text;
    context.fillText(column.label, x + width / 2, COLUMN_HEADER_HEIGHT / 2);
    context.strokeStyle = colors.grid;
    context.lineWidth = 1;
    context.strokeRect(crisp(x), 0.5, width, COLUMN_HEADER_HEIGHT);
  }
  context.restore();
}

function paintRowHeaders(
  context: CanvasRenderingContext2D,
  display: DisplayList,
  options: PaintOptions,
  frozen: boolean,
  clipY: number,
  clipHeight: number,
) {
  if (clipHeight <= 0) return;
  context.save();
  context.beginPath();
  context.rect(0, clipY, ROW_HEADER_WIDTH, clipHeight);
  context.clip();
  context.fillStyle = colors.chrome;
  context.fillRect(0, clipY, ROW_HEADER_WIDTH, clipHeight);
  for (const row of display.rows) {
    if ((row.index < display.freeze.rows) !== frozen) continue;
    const y = screenY(row, display, options);
    const height = row.size * options.zoom;
    if (row.index === options.selected.row) {
      context.fillStyle = colors.greenSoft;
      context.fillRect(0, y, ROW_HEADER_WIDTH, height);
    }
    context.fillStyle = row.index === options.selected.row ? colors.green : colors.text;
    context.fillText(row.label, ROW_HEADER_WIDTH / 2, y + height / 2);
    context.strokeStyle = colors.grid;
    context.lineWidth = 1;
    context.strokeRect(0.5, crisp(y), ROW_HEADER_WIDTH, height);
  }
  context.restore();
}

function crisp(value: number) {
  return Math.round(value) + 0.5;
}
