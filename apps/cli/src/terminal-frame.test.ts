/** Verifies deterministic responsive and accessible frames across required lifecycle states. */

import { describe, expect, it } from 'vitest';

import type {
  PositionedGraph,
  ProvenanceGraphView,
} from '@sourcezero/presentation';

import {
  createTerminalState,
  type TerminalState,
} from './terminal-controller.js';
import { renderTerminalFrame } from './terminal-frame.js';
import { createFixtureWorkspace } from './terminal-fixtures.js';

const accessibility = { screenReader: false, reducedDecoration: false };

describe('terminal frames', () => {
  it('renders a wide running workspace with a status sidebar', () => {
    const frame = renderTerminalFrame(
      workspaceState(),
      createFixtureWorkspace('running'),
      { columns: 100, rows: 20 },
      accessibility,
    );

    expect(frame).toContain('[Overview]');
    expect(frame).toContain('Investigation status');
    expect(frame).toContain('Status: running');
    expectBounded(frame, 100, 20);
  });

  it('switches a narrow terminal to a single-pane evidence view', () => {
    const frame = renderTerminalFrame(
      { ...workspaceState(), activeTab: 3 },
      createFixtureWorkspace('running'),
      { columns: 44, rows: 14 },
      accessibility,
    );

    expect(frame).toContain('Evidence view');
    expect(frame).not.toContain('Investigation status');
    expectBounded(frame, 44, 14);
  });

  it.each(['draft', 'running', 'failed', 'canceled', 'completed'])(
    'renders a fixed frame for %s investigations',
    (status) => {
      const frame = renderTerminalFrame(
        workspaceState(),
        createFixtureWorkspace(status),
        { columns: 72, rows: 16 },
        accessibility,
      );

      expect(frame).toContain(`Status: ${status}`);
      expectBounded(frame, 72, 16);
    },
  );

  it('renders explicit empty-state and screen-reader labels without decoration', () => {
    const frame = renderTerminalFrame(
      { ...workspaceState(), activeTab: 3 },
      createFixtureWorkspace('draft'),
      { columns: 60, rows: 14 },
      { screenReader: true, reducedDecoration: true },
    );

    expect(frame).toContain('SourceZero. Trace every claim back to zero.');
    expect(frame).toContain('Tabs. Selected Evidence, 4 of 6.');
    expect(frame).toContain('No evidence has been recorded yet.');
    expect(frame).not.toContain('[Evidence]');
  });

  it('renders structured framing failures in the workspace overview', () => {
    const base = createFixtureWorkspace('failed');
    const workspace = {
      ...base,
      framing: {
        ...base.framing,
        failure: {
          code: 'fetch_failed',
          stage: 'fetch' as const,
          message: 'The input page could not be retrieved.',
        },
      },
    };
    const frame = renderTerminalFrame(
      workspaceState(),
      workspace,
      { columns: 72, rows: 18 },
      accessibility,
    );

    expect(frame).toContain('Framing failure: fetch_failed (fetch)');
    expect(frame).toContain('The input page could not be retrieved.');
  });

  it('integrates the visual graph and selected evidence details', () => {
    const workspace = createFixtureWorkspace('running');
    const state = {
      ...workspaceState(),
      activeTab: 1,
      focus: 'content' as const,
      graphViewport: {
        ...workspaceState().graphViewport,
        selectedElementId: 'edge_study_report_a',
      },
    };
    const frame = renderTerminalFrame(
      state,
      workspace,
      { columns: 76, rows: 24 },
      accessibility,
      positionFixture(workspace.graph),
    );

    expect(frame).toContain('Graph view');
    expect(frame).toContain('N/P select');
    expect(frame).toContain('Original study');
    expect(frame).toContain('Selected: edge_study_report_a [cites]');
  });

  it('uses the complete adjacency representation in screen-reader mode', () => {
    const workspace = createFixtureWorkspace('running');
    const state = {
      ...workspaceState(),
      activeTab: 1,
      graphViewport: {
        ...workspaceState().graphViewport,
        selectedElementId: 'edge_study_report_a',
      },
    };
    const frame = renderTerminalFrame(
      state,
      workspace,
      { columns: 100, rows: 40 },
      { screenReader: true, reducedDecoration: true },
    );

    expect(frame).toContain('Tabs. Selected Graph, 2 of 6.');
    expect(frame).toContain('Nodes');
    expect(frame).toContain('Relationships');
    expect(frame).toContain('Original study -[cites]-> Syndicated report A');
    expect(frame).toContain('Evidence evidence_excerpt');
  });
});

function workspaceState(): TerminalState {
  return {
    ...createTerminalState(),
    screen: 'workspace',
    confirmedClaim: 'Fixture claim.',
  };
}

function expectBounded(frame: string, columns: number, rows: number): void {
  const lines = frame.split('\n');
  expect(lines.length).toBeLessThanOrEqual(rows);
  expect(lines.every((line) => line.length <= columns)).toBe(true);
}

function positionFixture(graph: ProvenanceGraphView): PositionedGraph {
  const nodes = graph.nodes.map((node, index) => ({
    ...node,
    x: (index % 3) * 23,
    y: Math.floor(index / 3) * 6,
    width: 20,
    height: 3,
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return {
    width: 66,
    height: 12,
    nodes,
    edges: graph.edges.map((edge) => {
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (source === undefined || target === undefined) {
        throw new Error('Fixture edge references an unknown node.');
      }
      return {
        ...edge,
        feedback: edge.id === 'edge_feedback',
        points: [
          { x: source.x + source.width, y: source.y + 1 },
          { x: target.x, y: target.y + 1 },
        ],
      };
    }),
  };
}
