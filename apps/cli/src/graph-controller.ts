/**
 * Owns graph viewport, filtering, selection, density, highlighting, and duplicate visibility.
 */

import {
  DEFAULT_MAX_VISIBLE_GRAPH_NODES,
  type GraphViewport,
  type PositionedGraph,
  type ProvenanceGraphView,
} from '@sourcezero/presentation';

import type { TerminalKey } from './terminal-controller.js';

export type GraphDensity = 'compact' | 'normal' | 'detailed';
export type GraphAlternative = 'visual' | 'adjacency';
export type GraphHighlight = 'none' | 'upstream' | 'descendants';
export type GraphNodeKindFilter =
  'all' | ProvenanceGraphView['nodes'][number]['kind'];

export interface GraphViewportState {
  readonly offsetX: GraphViewport['offsetX'];
  readonly offsetY: GraphViewport['offsetY'];
  readonly selectedElementId?: string;
  readonly density: GraphDensity;
  readonly alternative: GraphAlternative;
  readonly nodeKindFilter: GraphNodeKindFilter;
  readonly relationshipTypeFilter: string | undefined;
  readonly collapsedDuplicateGroups: readonly string[];
  readonly highlight: GraphHighlight;
  readonly maxVisibleNodes: number;
}

export function createGraphViewportState(): GraphViewportState {
  return {
    offsetX: 0,
    offsetY: 0,
    density: 'normal',
    alternative: 'visual',
    nodeKindFilter: 'all',
    relationshipTypeFilter: undefined,
    collapsedDuplicateGroups: [],
    highlight: 'none',
    maxVisibleNodes: DEFAULT_MAX_VISIBLE_GRAPH_NODES,
  };
}

export function transitionGraphViewport(
  state: GraphViewportState,
  key: TerminalKey,
  graph: ProvenanceGraphView,
): GraphViewportState {
  switch (key.kind) {
    case 'left':
      return { ...state, offsetX: Math.max(0, state.offsetX - 4) };
    case 'right':
      return { ...state, offsetX: state.offsetX + 4 };
    case 'up':
      return { ...state, offsetY: Math.max(0, state.offsetY - 2) };
    case 'down':
      return { ...state, offsetY: state.offsetY + 2 };
    case 'page_up':
      return { ...state, offsetY: Math.max(0, state.offsetY - 8) };
    case 'page_down':
      return { ...state, offsetY: state.offsetY + 8 };
    case 'home':
      return { ...state, offsetX: 0, offsetY: 0 };
    case 'text':
      return transitionGraphCommand(state, key.text.toLowerCase(), graph);
    default:
      return state;
  }
}

export function visiblePositionedGraph(
  graph: PositionedGraph,
  state: GraphViewportState,
): PositionedGraph {
  const representatives = duplicateRepresentatives(graph);
  const duplicateCounts = duplicateGroupCounts(graph);
  const visibleNodes = graph.nodes
    .filter((node) => {
      if (
        state.nodeKindFilter !== 'all' &&
        node.kind !== state.nodeKindFilter
      ) {
        return false;
      }
      return (
        node.duplicateGroupId === undefined ||
        !state.collapsedDuplicateGroups.includes(node.duplicateGroupId) ||
        representatives.get(node.duplicateGroupId) === node.id
      );
    })
    .slice(0, state.maxVisibleNodes)
    .map((node) => {
      if (
        node.duplicateGroupId === undefined ||
        !state.collapsedDuplicateGroups.includes(node.duplicateGroupId)
      ) {
        return node;
      }
      const hiddenCount = (duplicateCounts.get(node.duplicateGroupId) ?? 1) - 1;
      return hiddenCount <= 0
        ? node
        : { ...node, label: `${node.label} (+${hiddenCount.toString()})` };
    });
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter(
    (edge) =>
      visibleNodeIds.has(edge.sourceId) &&
      visibleNodeIds.has(edge.targetId) &&
      (state.relationshipTypeFilter === undefined ||
        edge.type === state.relationshipTypeFilter),
  );
  return { ...graph, nodes: visibleNodes, edges: visibleEdges };
}

export function highlightedNodeIds(
  graph: PositionedGraph,
  state: GraphViewportState,
): ReadonlySet<string> {
  const selected = graph.nodes.find(
    (node) => node.id === state.selectedElementId,
  );
  if (selected === undefined || state.highlight === 'none') {
    return new Set();
  }
  const reverse = state.highlight === 'upstream';
  const reached = new Set([selected.id]);
  const pending = [selected.id];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    for (const edge of graph.edges) {
      const from = reverse ? edge.targetId : edge.sourceId;
      const to = reverse ? edge.sourceId : edge.targetId;
      if (from === current && !reached.has(to)) {
        reached.add(to);
        pending.push(to);
      }
    }
  }
  return reached;
}

function transitionGraphCommand(
  state: GraphViewportState,
  command: string,
  graph: ProvenanceGraphView,
): GraphViewportState {
  switch (command) {
    case 'n':
      return selectRelative(state, graph, 1);
    case 'p':
      return selectRelative(state, graph, -1);
    case 'd':
      return { ...state, density: nextDensity(state.density) };
    case 'v':
      return {
        ...state,
        alternative: state.alternative === 'visual' ? 'adjacency' : 'visual',
      };
    case 'k':
      return { ...state, nodeKindFilter: nextNodeKind(state.nodeKindFilter) };
    case 'r':
      return {
        ...state,
        relationshipTypeFilter: nextRelationshipType(
          state.relationshipTypeFilter,
          graph,
        ),
      };
    case 'x':
      return toggleSelectedDuplicateGroup(state, graph);
    case 'u':
      return {
        ...state,
        highlight: state.highlight === 'upstream' ? 'none' : 'upstream',
      };
    case 'o':
      return {
        ...state,
        highlight: state.highlight === 'descendants' ? 'none' : 'descendants',
      };
    case 'c':
      return {
        ...state,
        nodeKindFilter: 'all',
        relationshipTypeFilter: undefined,
        collapsedDuplicateGroups: [],
        highlight: 'none',
      };
    default:
      return state;
  }
}

function selectRelative(
  state: GraphViewportState,
  graph: ProvenanceGraphView,
  direction: 1 | -1,
): GraphViewportState {
  const ids = [
    ...graph.nodes.map((node) => node.id),
    ...graph.edges.map((edge) => edge.id),
  ];
  if (ids.length === 0) return state;
  const current =
    state.selectedElementId === undefined
      ? direction === 1
        ? -1
        : 0
      : ids.indexOf(state.selectedElementId);
  const selectedElementId = ids[wrap(current + direction, ids.length)];
  return selectedElementId === undefined
    ? state
    : { ...state, selectedElementId };
}

function toggleSelectedDuplicateGroup(
  state: GraphViewportState,
  graph: ProvenanceGraphView,
): GraphViewportState {
  const groupId = graph.nodes.find(
    (node) => node.id === state.selectedElementId,
  )?.duplicateGroupId;
  if (groupId === undefined) return state;
  const collapsed = state.collapsedDuplicateGroups.includes(groupId);
  return {
    ...state,
    collapsedDuplicateGroups: collapsed
      ? state.collapsedDuplicateGroups.filter(
          (candidate) => candidate !== groupId,
        )
      : [...state.collapsedDuplicateGroups, groupId],
  };
}

function nextDensity(density: GraphDensity): GraphDensity {
  switch (density) {
    case 'compact':
      return 'normal';
    case 'normal':
      return 'detailed';
    case 'detailed':
      return 'compact';
  }
}

function nextNodeKind(filter: GraphNodeKindFilter): GraphNodeKindFilter {
  switch (filter) {
    case 'all':
      return 'claim';
    case 'claim':
      return 'source';
    case 'source':
      return 'evidence';
    case 'evidence':
      return 'all';
  }
}

function nextRelationshipType(
  current: string | undefined,
  graph: ProvenanceGraphView,
): string | undefined {
  const types = [...new Set(graph.edges.map((edge) => edge.type))].sort();
  if (types.length === 0) return undefined;
  if (current === undefined) return types[0];
  const index = types.indexOf(current);
  return index < 0 || index === types.length - 1 ? undefined : types[index + 1];
}

function duplicateRepresentatives(
  graph: PositionedGraph,
): ReadonlyMap<string, string> {
  const representatives = new Map<string, string>();
  for (const node of graph.nodes) {
    if (
      node.duplicateGroupId !== undefined &&
      !representatives.has(node.duplicateGroupId)
    ) {
      representatives.set(node.duplicateGroupId, node.id);
    }
  }
  return representatives;
}

function duplicateGroupCounts(
  graph: PositionedGraph,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.duplicateGroupId !== undefined) {
      counts.set(
        node.duplicateGroupId,
        (counts.get(node.duplicateGroupId) ?? 0) + 1,
      );
    }
  }
  return counts;
}

function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}
