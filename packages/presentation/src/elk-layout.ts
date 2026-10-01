/**
 * Adapts client-neutral provenance graphs to deterministic ELK positioned geometry.
 */

import ElkModule from 'elkjs';
import type {
  ELK,
  ELKConstructorArguments,
  ElkExtendedEdge,
  ElkNode,
  ElkPoint,
} from 'elkjs';

import type { ProvenanceGraphView } from './workspace.js';
import type {
  GraphLayout,
  GraphLayoutOptions,
  GraphPoint,
  PositionedGraph,
  PositionedGraphEdge,
  PositionedGraphNode,
} from './graph.js';

const defaultNodeWidth = 22;
const defaultNodeHeight = 3;
const defaultHorizontalSpacing = 8;
const defaultVerticalSpacing = 4;
const ElkConstructor = ElkModule as unknown as new (
  arguments_?: ELKConstructorArguments,
) => ELK;

/** Produces rounded character-cell geometry while keeping ELK types private. */
export class ElkGraphLayoutAdapter implements GraphLayout {
  readonly #elk: ELK;

  public constructor(elk: ELK = new ElkConstructor()) {
    this.#elk = elk;
  }

  public async layout(
    graph: ProvenanceGraphView,
    options: GraphLayoutOptions = {},
    signal?: AbortSignal,
  ): Promise<PositionedGraph> {
    signal?.throwIfAborted();
    validateGraph(graph);
    const nodeHeight = positiveInteger(
      options.nodeHeight,
      defaultNodeHeight,
      'node height',
    );
    const elkGraph: ElkNode = {
      id: 'sourcezero.graph',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': options.direction === 'down' ? 'DOWN' : 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.padding': '[top=1,left=1,bottom=1,right=1]',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
        'elk.spacing.nodeNode': positiveInteger(
          options.verticalSpacing,
          defaultVerticalSpacing,
          'vertical spacing',
        ).toString(),
        'elk.layered.spacing.nodeNodeBetweenLayers': positiveInteger(
          options.horizontalSpacing,
          defaultHorizontalSpacing,
          'horizontal spacing',
        ).toString(),
      },
      children: graph.nodes.map((node) => ({
        id: node.id,
        width: positiveInteger(
          options.measureNodeWidth?.(node),
          defaultNodeWidth,
          'node width',
        ),
        height: nodeHeight,
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        sources: [edge.sourceId],
        targets: [edge.targetId],
      })),
    };
    const laidOut = await this.#elk.layout(elkGraph);
    signal?.throwIfAborted();
    const positionedNodes = (laidOut.children ?? []).map((node) => {
      const original = graph.nodes.find(
        (candidate) => candidate.id === node.id,
      );
      if (original === undefined) {
        throw new TypeError(`ELK returned unknown node "${node.id}".`);
      }
      return {
        ...original,
        x: coordinate(node.x, 'node x'),
        y: coordinate(node.y, 'node y'),
        width: positiveInteger(node.width, defaultNodeWidth, 'node width'),
        height: positiveInteger(node.height, nodeHeight, 'node height'),
      };
    });
    const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
    const edgeById = new Map(
      (laidOut.edges ?? []).map((edge) => [edge.id, edge]),
    );
    const positionedEdges: PositionedGraphEdge[] = graph.edges.map((edge) => {
      const laidOutEdge = edgeById.get(edge.id);
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (
        laidOutEdge === undefined ||
        source === undefined ||
        target === undefined
      ) {
        throw new TypeError(`ELK omitted graph element "${edge.id}".`);
      }
      return {
        ...edge,
        points: edgePoints(laidOutEdge, source, target),
        feedback:
          participatesInCycle(edge, graph) &&
          isLayoutFeedback(source, target, options.direction ?? 'right'),
      };
    });
    return normalizeToNodeOrigin(positionedNodes, positionedEdges, laidOut);
  }
}

function normalizeToNodeOrigin(
  nodes: readonly PositionedGraphNode[],
  edges: readonly PositionedGraphEdge[],
  laidOut: ElkNode,
): PositionedGraph {
  if (nodes.length === 0) {
    return {
      width: dimension(laidOut.width, 1, 'graph width'),
      height: dimension(laidOut.height, 1, 'graph height'),
      nodes,
      edges,
    };
  }
  const offsetX = 1 - Math.min(...nodes.map((node) => node.x));
  const offsetY = 1 - Math.min(...nodes.map((node) => node.y));
  const normalizedNodes = nodes.map((node) => ({
    ...node,
    x: node.x + offsetX,
    y: node.y + offsetY,
  }));
  const normalizedEdges = edges.map((edge) => ({
    ...edge,
    points: edge.points.map((edgePoint) => ({
      x: edgePoint.x + offsetX,
      y: edgePoint.y + offsetY,
    })),
  }));
  return {
    width: boundingWidth(normalizedNodes) + 1,
    height: boundingHeight(normalizedNodes) + 1,
    nodes: normalizedNodes,
    edges: normalizedEdges,
  };
}

function dimension(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new TypeError(`ELK returned an invalid ${label}.`);
  }
  return Math.max(1, Math.round(resolved));
}

function validateGraph(graph: ProvenanceGraphView): void {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      throw new TypeError(`Graph contains duplicate node ID "${node.id}".`);
    }
    ids.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      throw new TypeError(`Graph contains duplicate edge ID "${edge.id}".`);
    }
    edgeIds.add(edge.id);
    if (!ids.has(edge.sourceId) || !ids.has(edge.targetId)) {
      throw new TypeError(
        `Graph edge "${edge.id}" references an unknown node.`,
      );
    }
  }
}

function edgePoints(
  edge: ElkExtendedEdge,
  source: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  target: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): readonly GraphPoint[] {
  const section = edge.sections?.[0];
  if (section === undefined) {
    return [center(source), center(target)];
  }
  return [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint,
  ].map(point);
}

function point(value: ElkPoint): GraphPoint {
  return { x: coordinate(value.x, 'edge x'), y: coordinate(value.y, 'edge y') };
}

function center(node: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): GraphPoint {
  return {
    x: Math.round(node.x + node.width / 2),
    y: Math.round(node.y + node.height / 2),
  };
}

function participatesInCycle(
  edge: ProvenanceGraphView['edges'][number],
  graph: ProvenanceGraphView,
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const candidate of graph.edges) {
    if (candidate.id === edge.id) continue;
    const targets = outgoing.get(candidate.sourceId) ?? [];
    targets.push(candidate.targetId);
    outgoing.set(candidate.sourceId, targets);
  }
  const pending = [edge.targetId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || visited.has(nodeId)) continue;
    if (nodeId === edge.sourceId) return true;
    visited.add(nodeId);
    pending.push(...(outgoing.get(nodeId) ?? []));
  }
  return false;
}

function isLayoutFeedback(
  source: { readonly x: number; readonly y: number },
  target: { readonly x: number; readonly y: number },
  direction: NonNullable<GraphLayoutOptions['direction']>,
): boolean {
  return direction === 'right' ? target.x <= source.x : target.y <= source.y;
}

function coordinate(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new TypeError(`ELK returned an invalid ${label}.`);
  }
  return Math.max(0, Math.round(value));
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new TypeError(`Graph ${label} must be a positive finite number.`);
  }
  return Math.max(1, Math.round(resolved));
}

function boundingWidth(
  nodes: readonly { readonly x: number; readonly width: number }[],
): number {
  return Math.max(1, ...nodes.map((node) => node.x + node.width));
}

function boundingHeight(
  nodes: readonly { readonly y: number; readonly height: number }[],
): number {
  return Math.max(1, ...nodes.map((node) => node.y + node.height));
}
