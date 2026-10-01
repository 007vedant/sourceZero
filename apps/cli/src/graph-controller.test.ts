/** Verifies graph navigation, filters, duplicate collapse, and directional highlighting. */

import { describe, expect, it } from 'vitest';

import type {
  PositionedGraph,
  ProvenanceGraphView,
} from '@sourcezero/presentation';

import {
  createGraphViewportState,
  highlightedNodeIds,
  transitionGraphViewport,
  visiblePositionedGraph,
  type GraphViewportState,
} from './graph-controller.js';

const graphView: ProvenanceGraphView = {
  nodes: [
    { id: 'origin', kind: 'source', label: 'Origin' },
    {
      id: 'copy_a',
      kind: 'source',
      label: 'Copy A',
      duplicateGroupId: 'copies',
    },
    {
      id: 'copy_b',
      kind: 'source',
      label: 'Copy B',
      duplicateGroupId: 'copies',
    },
    { id: 'claim', kind: 'claim', label: 'Claim' },
  ],
  edges: [
    { id: 'e1', sourceId: 'origin', targetId: 'copy_a', type: 'cites' },
    { id: 'e2', sourceId: 'copy_a', targetId: 'claim', type: 'copies' },
    { id: 'e3', sourceId: 'copy_b', targetId: 'claim', type: 'copies' },
  ],
};

const positioned: PositionedGraph = {
  width: 80,
  height: 20,
  nodes: graphView.nodes.map((node, index) => ({
    ...node,
    x: index * 18,
    y: 2,
    width: 12,
    height: 3,
  })),
  edges: graphView.edges.map((edge, index) => ({
    ...edge,
    feedback: false,
    points: [
      { x: index * 18 + 12, y: 3 },
      { x: index * 18 + 18, y: 3 },
    ],
  })),
};

describe('graph viewport controller', () => {
  it('pans, selects, changes density, and switches alternatives', () => {
    let state = createGraphViewportState();
    state = transitionGraphViewport(state, { kind: 'right' }, graphView);
    state = transitionGraphViewport(state, { kind: 'down' }, graphView);
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'n' },
      graphView,
    );
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'd' },
      graphView,
    );
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'v' },
      graphView,
    );

    expect(state).toMatchObject({
      offsetX: 4,
      offsetY: 2,
      selectedElementId: 'origin',
      density: 'detailed',
      alternative: 'adjacency',
    });
    state = transitionGraphViewport(state, { kind: 'home' }, graphView);
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'p' },
      graphView,
    );
    expect(state).toMatchObject({
      offsetX: 0,
      offsetY: 0,
      selectedElementId: 'e3',
    });
  });

  it('cycles filters and collapses only the selected duplicate group', () => {
    let state = createGraphViewportState();
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'k' },
      graphView,
    );
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'r' },
      graphView,
    );
    state = { ...state, selectedElementId: 'copy_a' };
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'x' },
      graphView,
    );
    const visible = visiblePositionedGraph(positioned, state);

    expect(state.nodeKindFilter).toBe('claim');
    expect(state.relationshipTypeFilter).toBe('cites');
    expect(state.collapsedDuplicateGroups).toEqual(['copies']);
    expect(visible.nodes.map((node) => node.id)).toEqual(['claim']);
    expect(visible.edges).toEqual([]);
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'c' },
      graphView,
    );
    expect(state).toMatchObject({
      nodeKindFilter: 'all',
      relationshipTypeFilter: undefined,
      collapsedDuplicateGroups: [],
    });
    state = { ...state, selectedElementId: 'copy_a' };
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'x' },
      graphView,
    );
    expect(visiblePositionedGraph(positioned, state).nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'copy_a', label: 'Copy A (+1)' }),
      ]),
    );
    expect(
      visiblePositionedGraph(positioned, { ...state, maxVisibleNodes: 1 })
        .nodes,
    ).toHaveLength(1);
  });

  it('highlights upstream and descendant paths from the selected node', () => {
    let state: GraphViewportState = {
      ...createGraphViewportState(),
      selectedElementId: 'copy_a',
    };
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'u' },
      graphView,
    );
    expect([...highlightedNodeIds(positioned, state)].sort()).toEqual([
      'copy_a',
      'origin',
    ]);
    state = transitionGraphViewport(
      state,
      { kind: 'text', text: 'o' },
      graphView,
    );
    expect([...highlightedNodeIds(positioned, state)].sort()).toEqual([
      'claim',
      'copy_a',
    ]);
  });
});
