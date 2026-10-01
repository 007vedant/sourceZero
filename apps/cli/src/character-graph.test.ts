/** Verifies Unicode cell rendering, clipping, details, adjacency parity, and bounded performance. */

import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_VISIBLE_GRAPH_NODES,
  type PositionedGraph,
  type ProvenanceGraphView,
} from '@sourcezero/presentation';
import stringWidth from 'string-width';

import {
  renderCharacterGraph,
  renderGraphAdjacency,
  selectedGraphDetail,
} from './character-graph.js';
import { createGraphViewportState } from './graph-controller.js';

const positioned: PositionedGraph = {
  width: 48,
  height: 16,
  nodes: [
    {
      id: 'claim',
      kind: 'claim',
      label: '主張 claim',
      x: 1,
      y: 1,
      width: 14,
      height: 3,
    },
    {
      id: 'source',
      kind: 'source',
      label: 'Source',
      x: 30,
      y: 1,
      width: 12,
      height: 3,
    },
    {
      id: 'evidence',
      kind: 'evidence',
      label: 'Evidence',
      x: 16,
      y: 10,
      width: 14,
      height: 3,
    },
  ],
  edges: [
    {
      id: 'horizontal',
      sourceId: 'claim',
      targetId: 'source',
      type: 'cites',
      feedback: false,
      points: [
        { x: 15, y: 2 },
        { x: 30, y: 2 },
      ],
    },
    {
      id: 'crossing',
      sourceId: 'evidence',
      targetId: 'source',
      type: 'supports',
      feedback: false,
      points: [
        { x: 23, y: 10 },
        { x: 23, y: 2 },
        { x: 30, y: 2 },
      ],
    },
    {
      id: 'feedback',
      sourceId: 'source',
      targetId: 'claim',
      type: 'unresolved',
      feedback: true,
      points: [
        { x: 30, y: 3 },
        { x: 15, y: 3 },
      ],
    },
  ],
};

describe('character graph renderer', () => {
  it('renders distinct nodes, junctions, arrows, feedback, Unicode, and clipping', () => {
    const viewport = {
      ...createGraphViewportState(),
      selectedElementId: 'claim',
    };
    const frame = renderCharacterGraph(positioned, viewport, {
      width: 38,
      height: 9,
    });

    expect(frame.join('\n')).toMatchSnapshot();
    expect(frame.some((line) => line.includes('┼'))).toBe(true);
    expect(frame.some((line) => line.includes('↩'))).toBe(true);
    expect(frame.every((line) => stringWidth(line) <= 38)).toBe(true);
  });

  it('retains every material node, relationship, explanation, and evidence in adjacency/details', () => {
    const graph = provenanceView(positioned);
    const viewport = {
      ...createGraphViewportState(),
      alternative: 'adjacency' as const,
      selectedElementId: 'horizontal',
    };
    const adjacency = renderGraphAdjacency(graph, viewport).join('\n');
    const detail = selectedGraphDetail(graph, viewport).join('\n');

    for (const node of graph.nodes) expect(adjacency).toContain(node.label);
    for (const edge of graph.edges) expect(adjacency).toContain(edge.type);
    expect(detail).toContain('Explanation: Relationship explanation.');
    expect(detail).toContain('Evidence excerpt_1: Exact fixture excerpt.');
  });

  it('shows selection, directional highlighting, and semantic density without color', () => {
    const selectedEdge = renderCharacterGraph(
      positioned,
      { ...createGraphViewportState(), selectedElementId: 'horizontal' },
      { width: 48, height: 15 },
    ).join('\n');
    const highlighted = renderCharacterGraph(
      positioned,
      {
        ...createGraphViewportState(),
        selectedElementId: 'claim',
        highlight: 'descendants',
      },
      { width: 48, height: 15 },
    ).join('\n');
    const detailed = renderCharacterGraph(
      {
        width: 32,
        height: 5,
        nodes: [
          {
            id: 'wide',
            kind: 'source',
            label: 'Wide source',
            x: 0,
            y: 0,
            width: 30,
            height: 3,
          },
        ],
        edges: [],
      },
      { ...createGraphViewportState(), density: 'detailed' },
      { width: 32, height: 5 },
    ).join('\n');

    expect(selectedEdge).toContain('◆');
    expect(highlighted).toContain('!──────────┐');
    expect(detailed).toContain('Wide source (source)');
  });

  it('renders the configured visible-node limit within a responsive bound', () => {
    const large = largePositionedGraph(DEFAULT_MAX_VISIBLE_GRAPH_NODES);
    const start = performance.now();
    const frame = renderCharacterGraph(large, createGraphViewportState(), {
      width: 120,
      height: 40,
    });
    const duration = performance.now() - start;

    expect(frame).toHaveLength(40);
    expect(duration).toBeLessThan(250);
  });
});

function provenanceView(graph: PositionedGraph): ProvenanceGraphView {
  const detail = {
    summary: 'Relationship explanation.',
    evidence: [{ id: 'excerpt_1', excerpt: 'Exact fixture excerpt.' }],
  };
  return {
    nodes: graph.nodes.map(({ id, kind, label }) => ({
      id,
      kind,
      label,
      detail,
    })),
    edges: graph.edges.map(({ id, sourceId, targetId, type }) => ({
      id,
      sourceId,
      targetId,
      type,
      detail,
    })),
  };
}

function largePositionedGraph(count: number): PositionedGraph {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `node_${index.toString()}`,
    kind: 'source' as const,
    label: `Source ${index.toString()}`,
    x: (index % 25) * 16,
    y: Math.floor(index / 25) * 5,
    width: 12,
    height: 3,
  }));
  return {
    width: 400,
    height: Math.ceil(count / 25) * 5,
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `edge_${index.toString()}`,
      sourceId: nodes[index]?.id ?? node.id,
      targetId: node.id,
      type: 'cites',
      feedback: false,
      points: [
        { x: node.x - 4, y: node.y + 1 },
        { x: node.x, y: node.y + 1 },
      ],
    })),
  };
}
