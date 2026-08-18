import type {
  AxisMetric,
  CellCoord,
  CellStyle,
  CellValue,
  DisplayChart,
  DisplayList,
} from "../engine/types";
import { COLUMN_HEADER_HEIGHT, ROW_HEADER_WIDTH } from "./geometry";

type PaintOptions = {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
  selected: CellCoord;
  devicePixelRatio: number;
};

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
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = colors.canvas;
  context.fillRect(0, 0, width, height);

  context.save();
  context.beginPath();
  context.rect(
    ROW_HEADER_WIDTH,
    COLUMN_HEADER_HEIGHT,
    width - ROW_HEADER_WIDTH,
    height - COLUMN_HEADER_HEIGHT,
  );
  context.clip();
  paintGrid(context, display, options);
  paintCells(context, display, options);
  for (const chart of display.charts) {
    paintChart(context, chart, display, options);
  }
  paintSelection(context, display, options);
  context.restore();
  paintHeaders(context, display, options);
}

function screenX(metric: AxisMetric, display: DisplayList, options: PaintOptions) {
  return (
    ROW_HEADER_WIDTH +
    (display.originX + metric.offset) * options.zoom -
    options.scrollX
  );
}

function screenY(metric: AxisMetric, display: DisplayList, options: PaintOptions) {
  return (
    COLUMN_HEADER_HEIGHT +
    (display.originY + metric.offset) * options.zoom -
    options.scrollY
  );
}

function paintGrid(
  context: CanvasRenderingContext2D,
  display: DisplayList,
  options: PaintOptions,
) {
  context.strokeStyle = colors.grid;
  context.lineWidth = 1;
  context.beginPath();
  for (const column of display.columns) {
    const x = crisp(screenX(column, display, options));
    context.moveTo(x, COLUMN_HEADER_HEIGHT);
    context.lineTo(x, options.height);
  }
  const lastColumn = display.columns.at(-1);
  if (lastColumn) {
    const x = crisp(
      screenX(lastColumn, display, options) + lastColumn.size * options.zoom,
    );
    context.moveTo(x, COLUMN_HEADER_HEIGHT);
    context.lineTo(x, options.height);
  }
  for (const row of display.rows) {
    const y = crisp(screenY(row, display, options));
    context.moveTo(ROW_HEADER_WIDTH, y);
    context.lineTo(options.width, y);
  }
  const lastRow = display.rows.at(-1);
  if (lastRow) {
    const y = crisp(
      screenY(lastRow, display, options) + lastRow.size * options.zoom,
    );
    context.moveTo(ROW_HEADER_WIDTH, y);
    context.lineTo(options.width, y);
  }
  context.stroke();
}

function paintCells(
  context: CanvasRenderingContext2D,
  display: DisplayList,
  options: PaintOptions,
) {
  for (const cell of display.cells) {
    const style = display.styles[cell.styleId] ?? display.styles[0];
    const x = ROW_HEADER_WIDTH + (display.originX + cell.x) * options.zoom - options.scrollX;
    const y = COLUMN_HEADER_HEIGHT + (display.originY + cell.y) * options.zoom - options.scrollY;
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
    ? wrapText(text, Math.max(1, width - padding * 2), (line) => context.measureText(line).width, maxLines)
    : [text];
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
  const lines: string[] = [];
  const paragraphs = text.split(/\r?\n/);
  let truncated = false;

  const pushLine = (line: string) => {
    if (lines.length >= maxLines) {
      truncated = true;
      return false;
    }
    lines.push(line);
    return true;
  };

  for (const paragraph of paragraphs) {
    if (lines.length >= maxLines) break;
    if (!paragraph.trim()) {
      pushLine("");
      continue;
    }
    let current = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const chunks: string[] = [];
      let remainder = word;
      while (measure(remainder) > maxWidth && remainder.length > 1) {
        let split = remainder.length - 1;
        while (split > 1 && measure(remainder.slice(0, split)) > maxWidth) split -= 1;
        chunks.push(remainder.slice(0, split));
        remainder = remainder.slice(split);
      }
      chunks.push(remainder);
      for (const chunk of chunks) {
        const candidate = current ? `${current} ${chunk}` : chunk;
        if (!current || measure(candidate) <= maxWidth) {
          current = candidate;
          continue;
        }
        if (!pushLine(current)) break;
        current = chunk;
      }
      if (lines.length >= maxLines) break;
    }
    if (lines.length < maxLines && current) pushLine(current);
  }

  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
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

function paintChart(
  context: CanvasRenderingContext2D,
  chart: DisplayChart,
  display: DisplayList,
  options: PaintOptions,
) {
  const x = ROW_HEADER_WIDTH + (display.originX + chart.x) * options.zoom - options.scrollX;
  const y = COLUMN_HEADER_HEIGHT + (display.originY + chart.y) * options.zoom - options.scrollY;
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
) {
  const column = display.columns.find((metric) => metric.index === options.selected.column);
  const row = display.rows.find((metric) => metric.index === options.selected.row);
  if (!column || !row) return;
  const selectedCell = display.cells.find(
    (cell) => cell.row === options.selected.row && cell.column === options.selected.column,
  );
  const x = screenX(column, display, options);
  const y = screenY(row, display, options);
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
  context.fillStyle = colors.chrome;
  context.fillRect(0, 0, options.width, COLUMN_HEADER_HEIGHT);
  context.fillRect(0, 0, ROW_HEADER_WIDTH, options.height);
  context.fillStyle = "#edf1f4";
  context.beginPath();
  context.moveTo(ROW_HEADER_WIDTH - 6, 7);
  context.lineTo(ROW_HEADER_WIDTH - 6, COLUMN_HEADER_HEIGHT - 6);
  context.lineTo(ROW_HEADER_WIDTH - 22, COLUMN_HEADER_HEIGHT - 6);
  context.closePath();
  context.fill();
  context.font = "500 12px Inter, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const column of display.columns) {
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
    context.strokeRect(crisp(x), 0.5, width, COLUMN_HEADER_HEIGHT);
  }
  for (const row of display.rows) {
    const y = screenY(row, display, options);
    const height = row.size * options.zoom;
    if (row.index === options.selected.row) {
      context.fillStyle = colors.greenSoft;
      context.fillRect(0, y, ROW_HEADER_WIDTH, height);
    }
    context.fillStyle = row.index === options.selected.row ? colors.green : colors.text;
    context.fillText(row.label, ROW_HEADER_WIDTH / 2, y + height / 2);
    context.strokeStyle = colors.grid;
    context.strokeRect(0.5, crisp(y), ROW_HEADER_WIDTH, height);
  }
  context.fillStyle = colors.chrome;
  context.fillRect(0, 0, ROW_HEADER_WIDTH, COLUMN_HEADER_HEIGHT);
  context.strokeStyle = colors.grid;
  context.strokeRect(0.5, 0.5, ROW_HEADER_WIDTH, COLUMN_HEADER_HEIGHT);

  const freezeColumn = display.columns.find(
    (metric) => metric.index === display.freeze.columns,
  );
  if (display.freeze.columns > 0 && freezeColumn) {
    const x = screenX(freezeColumn, display, options);
    context.strokeStyle = "#aeb7c0";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(crisp(x), COLUMN_HEADER_HEIGHT);
    context.lineTo(crisp(x), options.height);
    context.stroke();
  }
  const freezeRow = display.rows.find((metric) => metric.index === display.freeze.rows);
  if (display.freeze.rows > 0 && freezeRow) {
    const y = screenY(freezeRow, display, options);
    context.strokeStyle = "#aeb7c0";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(ROW_HEADER_WIDTH, crisp(y));
    context.lineTo(options.width, crisp(y));
    context.stroke();
  }
}

function crisp(value: number) {
  return Math.round(value) + 0.5;
}
