/**
 * Declares platform-neutral positioned graph and viewport contracts.
 */

import type { ProvenanceGraphView } from './workspace.js';

export const DEFAULT_MAX_VISIBLE_GRAPH_NODES = 250;

export interface GraphPoint {
  readonly x: number;
  readonly y: number;
}

export interface PositionedGraphNode {
  readonly id: string;
  readonly kind: ProvenanceGraphView['nodes'][number]['kind'];
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly duplicateGroupId?: string;
  readonly detail?: ProvenanceGraphView['nodes'][number]['detail'];
}

export interface PositionedGraphEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly type: string;
  readonly points: readonly GraphPoint[];
  readonly feedback: boolean;
  readonly detail?: ProvenanceGraphView['edges'][number]['detail'];
}

export interface PositionedGraph {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly PositionedGraphNode[];
  readonly edges: readonly PositionedGraphEdge[];
}

export interface GraphViewport {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export interface GraphLayoutOptions {
  readonly direction?: 'right' | 'down';
  readonly horizontalSpacing?: number;
  readonly verticalSpacing?: number;
  readonly nodeHeight?: number;
  readonly measureNodeWidth?: (
    node: ProvenanceGraphView['nodes'][number],
  ) => number;
}

export interface GraphLayout {
  layout(
    graph: ProvenanceGraphView,
    options?: GraphLayoutOptions,
    signal?: AbortSignal,
  ): Promise<PositionedGraph>;
}
