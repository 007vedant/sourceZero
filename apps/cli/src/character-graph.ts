/**
 * Renders positioned graphs into clipped Unicode-aware terminal character cells.
 */

import type {
  PositionedGraph,
  PositionedGraphEdge,
  PositionedGraphNode,
  ProvenanceGraphView,
} from '@sourcezero/presentation';
import stringWidth from 'string-width';

import {
  highlightedNodeIds,
  visiblePositionedGraph,
  type GraphViewportState,
} from './graph-controller.js';

export interface CharacterGraphOptions {
  readonly width: number;
  readonly height: number;
}

const edgeGlyphs = new Set(['─', '│', '┼', '·']);

export function renderCharacterGraph(
  graph: PositionedGraph,
  viewport: GraphViewportState,
  options: CharacterGraphOptions,
): readonly string[] {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const cells = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ' '),
  );
  const visible = visiblePositionedGraph(graph, viewport);
  const highlighted = highlightedNodeIds(visible, viewport);
  for (const edge of visible.edges) {
    drawEdge(cells, edge, viewport, highlighted);
  }
  drawSelectedEdgeMarker(cells, visible.edges, viewport);
  for (const node of visible.nodes) {
    drawNode(cells, node, viewport, highlighted);
  }
  return cells.map((row) => row.join('').trimEnd());
}

export function renderGraphAdjacency(
  graph: ProvenanceGraphView,
  viewport: GraphViewportState,
): readonly string[] {
  if (graph.nodes.length === 0) {
    return ['No provenance graph elements yet.'];
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const lines = ['Nodes'];
  for (const node of graph.nodes) {
    lines.push(
      `${selectionPrefix(node.id, viewport)}${node.id} [${node.kind}] ${node.label}`,
    );
  }
  lines.push('Relationships');
  for (const edge of graph.edges) {
    const source = nodeById.get(edge.sourceId)?.label ?? edge.sourceId;
    const target = nodeById.get(edge.targetId)?.label ?? edge.targetId;
    lines.push(
      `${selectionPrefix(edge.id, viewport)}${edge.id}: ${source} -[${edge.type}]-> ${target}`,
    );
  }
  return lines;
}

export function selectedGraphDetail(
  graph: ProvenanceGraphView,
  viewport: GraphViewportState,
): readonly string[] {
  const node = graph.nodes.find(
    (candidate) => candidate.id === viewport.selectedElementId,
  );
  const edge = graph.edges.find(
    (candidate) => candidate.id === viewport.selectedElementId,
  );
  const element = node ?? edge;
  if (element === undefined) return ['Selected: none'];
  const lines = [
    `Selected: ${element.id}${node === undefined ? ` [${edge?.type ?? 'relationship'}]` : ` [${node.kind}]`}`,
  ];
  if (element.detail !== undefined) {
    lines.push(`Explanation: ${element.detail.summary}`);
    lines.push(
      ...element.detail.evidence.map(
        (evidence) => `Evidence ${evidence.id}: ${evidence.excerpt}`,
      ),
    );
  }
  return lines;
}

function drawEdge(
  cells: string[][],
  edge: PositionedGraphEdge,
  viewport: GraphViewportState,
  highlighted: ReadonlySet<string>,
): void {
  const related =
    highlighted.size === 0 ||
    (highlighted.has(edge.sourceId) && highlighted.has(edge.targetId));
  const horizontal = related ? '─' : '·';
  const vertical = related ? '│' : '·';
  const points = edge.points.map((point) => ({
    x: Math.round(point.x) - viewport.offsetX,
    y: Math.round(point.y) - viewport.offsetY,
  }));
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start === undefined || end === undefined) continue;
    drawSegment(cells, start.x, start.y, end.x, start.y, horizontal);
    drawSegment(cells, end.x, start.y, end.x, end.y, vertical);
    setCell(cells, end.x, start.y, '┼');
  }
  const beforeEnd = points.at(-2);
  const end = points.at(-1);
  if (beforeEnd !== undefined && end !== undefined) {
    setCell(cells, end.x, end.y, arrowFor(beforeEnd, end, edge.feedback));
  }
}

function drawSelectedEdgeMarker(
  cells: string[][],
  edges: readonly PositionedGraphEdge[],
  viewport: GraphViewportState,
): void {
  const edge = edges.find(
    (candidate) => candidate.id === viewport.selectedElementId,
  );
  if (edge === undefined) return;
  const marker = longestSegmentMiddle(
    edge.points.map((point) => ({
      x: Math.round(point.x) - viewport.offsetX,
      y: Math.round(point.y) - viewport.offsetY,
    })),
  );
  if (marker !== undefined) setCell(cells, marker.x, marker.y, '◆');
}

function longestSegmentMiddle(
  points: readonly { readonly x: number; readonly y: number }[],
): { readonly x: number; readonly y: number } | undefined {
  let longest:
    | {
        readonly start: { readonly x: number; readonly y: number };
        readonly end: { readonly x: number; readonly y: number };
        readonly length: number;
      }
    | undefined;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start === undefined || end === undefined) continue;
    const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (longest === undefined || length > longest.length) {
      longest = { start, end, length };
    }
  }
  return longest === undefined
    ? undefined
    : {
        x: Math.round((longest.start.x + longest.end.x) / 2),
        y: Math.round((longest.start.y + longest.end.y) / 2),
      };
}

function drawNode(
  cells: string[][],
  node: PositionedGraphNode,
  viewport: GraphViewportState,
  highlighted: ReadonlySet<string>,
): void {
  const left = node.x - viewport.offsetX;
  const top = node.y - viewport.offsetY;
  const width = Math.max(5, node.width);
  const height = Math.max(3, node.height);
  const border = borders(node.kind);
  drawSegment(cells, left + 1, top, left + width - 2, top, border.horizontal);
  drawSegment(
    cells,
    left + 1,
    top + height - 1,
    left + width - 2,
    top + height - 1,
    border.horizontal,
  );
  drawSegment(cells, left, top + 1, left, top + height - 2, border.vertical);
  drawSegment(
    cells,
    left + width - 1,
    top + 1,
    left + width - 1,
    top + height - 2,
    border.vertical,
  );
  setCell(
    cells,
    left,
    top,
    node.id === viewport.selectedElementId
      ? '*'
      : highlighted.has(node.id)
        ? '!'
        : border.topLeft,
  );
  setCell(cells, left + width - 1, top, border.topRight);
  setCell(cells, left, top + height - 1, border.bottomLeft);
  setCell(cells, left + width - 1, top + height - 1, border.bottomRight);
  const label =
    viewport.density === 'compact'
      ? node.label.slice(0, 3)
      : viewport.density === 'detailed'
        ? `${node.label} (${node.kind})`
        : node.label;
  setText(cells, left + 2, top + Math.floor(height / 2), label, width - 4);
}

function drawSegment(
  cells: string[][],
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  glyph: string,
): void {
  const deltaX = Math.sign(endX - startX);
  const deltaY = Math.sign(endY - startY);
  const length = Math.max(Math.abs(endX - startX), Math.abs(endY - startY));
  for (let step = 0; step <= length; step += 1) {
    setCell(cells, startX + deltaX * step, startY + deltaY * step, glyph);
  }
}

function setCell(cells: string[][], x: number, y: number, glyph: string): void {
  const row = cells[y];
  if (row === undefined || x < 0 || x >= row.length) return;
  const existing = row[x] ?? ' ';
  row[x] =
    existing === ' ' || existing === glyph
      ? glyph
      : edgeGlyphs.has(existing) && edgeGlyphs.has(glyph)
        ? '┼'
        : glyph;
}

function setText(
  cells: string[][],
  x: number,
  y: number,
  text: string,
  maximumWidth: number,
): void {
  const row = cells[y];
  if (row === undefined || maximumWidth <= 0) return;
  let cursor = x;
  let used = 0;
  for (const character of text) {
    const width = stringWidth(character);
    if (used + width > maximumWidth) break;
    if (width === 0) {
      const previous = row[cursor - 1];
      if (previous !== undefined) row[cursor - 1] = `${previous}${character}`;
      continue;
    }
    if (cursor >= 0 && cursor < row.length) row[cursor] = character;
    if (width === 2 && cursor + 1 >= 0 && cursor + 1 < row.length) {
      row[cursor + 1] = '';
    }
    cursor += width;
    used += width;
  }
}

function arrowFor(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  feedback: boolean,
): string {
  if (feedback) return '↩';
  if (end.x > start.x) return '▶';
  if (end.x < start.x) return '◀';
  return end.y > start.y ? '▼' : '▲';
}

function borders(kind: PositionedGraphNode['kind']) {
  switch (kind) {
    case 'claim':
      return {
        horizontal: '═',
        vertical: '║',
        topLeft: '╔',
        topRight: '╗',
        bottomLeft: '╚',
        bottomRight: '╝',
      } as const;
    case 'source':
      return {
        horizontal: '─',
        vertical: '│',
        topLeft: '┌',
        topRight: '┐',
        bottomLeft: '└',
        bottomRight: '┘',
      } as const;
    case 'evidence':
      return {
        horizontal: '━',
        vertical: '┃',
        topLeft: '┏',
        topRight: '┓',
        bottomLeft: '┗',
        bottomRight: '┛',
      } as const;
  }
}

function selectionPrefix(id: string, viewport: GraphViewportState): string {
  return id === viewport.selectedElementId ? '* ' : '  ';
}
