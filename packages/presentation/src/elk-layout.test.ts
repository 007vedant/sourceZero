/** Verifies deterministic ELK positioning for the milestone graph topology fixtures. */

import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import type { ProvenanceGraphView } from './workspace.js';
import { ElkGraphLayoutAdapter } from './elk-layout.js';
import { DEFAULT_MAX_VISIBLE_GRAPH_NODES } from './graph.js';

const layout = new ElkGraphLayoutAdapter();
const options = {
  nodeHeight: 3,
  measureNodeWidth: () => 12,
  horizontalSpacing: 6,
  verticalSpacing: 3,
} as const;

describe('ElkGraphLayoutAdapter', () => {
  it.each([
    ['empty', graph([], [])],
    [
      'tree',
      graph(
        ['root', 'left', 'right'],
        [
          ['root', 'left'],
          ['root', 'right'],
        ],
      ),
    ],
    [
      'diamond',
      graph(
        ['origin', 'branch_a', 'branch_b', 'claim'],
        [
          ['origin', 'branch_a'],
          ['origin', 'branch_b'],
          ['branch_a', 'claim'],
          ['branch_b', 'claim'],
        ],
      ),
    ],
    [
      'multiple origins',
      graph(
        ['origin_a', 'origin_b', 'claim'],
        [
          ['origin_a', 'claim'],
          ['origin_b', 'claim'],
        ],
      ),
    ],
    [
      'cycle',
      graph(
        ['a', 'b', 'c'],
        [
          ['a', 'b'],
          ['b', 'c'],
          ['c', 'a'],
        ],
      ),
    ],
    [
      'crossing',
      graph(
        ['left_a', 'left_b', 'right_a', 'right_b'],
        [
          ['left_a', 'right_b'],
          ['left_b', 'right_a'],
        ],
      ),
    ],
    [
      'duplicates',
      graph(
        ['origin', 'copy_a', 'copy_b'],
        [
          ['origin', 'copy_a'],
          ['origin', 'copy_b'],
        ],
        new Map([
          ['copy_a', 'copies'],
          ['copy_b', 'copies'],
        ]),
      ),
    ],
  ])('positions the %s fixture deterministically', async (_name, fixture) => {
    const first = await layout.layout(fixture, options);
    const second = await layout.layout(fixture, options);

    expect(summarize(first)).toEqual(summarize(second));
    expect(summarize(first)).toMatchSnapshot();
  });

  it('rejects invalid references and observes cancellation', async () => {
    await expect(
      layout.layout(graph(['known'], [['known', 'missing']]), options),
    ).rejects.toThrow('unknown node');
    const controller = new AbortController();
    controller.abort();
    await expect(
      layout.layout(graph(['known'], []), options, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('lays out the configured visible-node limit within a responsive bound', async () => {
    const nodeIds = Array.from(
      { length: DEFAULT_MAX_VISIBLE_GRAPH_NODES },
      (_, index) => `node_${index.toString()}`,
    );
    const edges = nodeIds
      .slice(1)
      .map((nodeId, index) => [nodeIds[index] ?? nodeId, nodeId] as const);
    const start = performance.now();
    const positioned = await layout.layout(graph(nodeIds, edges), options);
    const duration = performance.now() - start;

    expect(positioned.nodes).toHaveLength(DEFAULT_MAX_VISIBLE_GRAPH_NODES);
    expect(duration).toBeLessThan(2000);
  });
});

function graph(
  nodeIds: readonly string[],
  edgePairs: readonly (readonly [string, string])[],
  duplicateGroups: ReadonlyMap<string, string> = new Map(),
): ProvenanceGraphView {
  return {
    nodes: nodeIds.map((id, index) => {
      const node = {
        id,
        kind:
          index % 3 === 0
            ? ('claim' as const)
            : index % 3 === 1
              ? ('source' as const)
              : ('evidence' as const),
        label: id,
      };
      const duplicateGroupId = duplicateGroups.get(id);
      return duplicateGroupId === undefined
        ? node
        : { ...node, duplicateGroupId };
    }),
    edges: edgePairs.map(([sourceId, targetId], index) => ({
      id: `edge_${index.toString()}`,
      sourceId,
      targetId,
      type: index % 2 === 0 ? 'cites' : 'copies',
    })),
  };
}

function summarize(
  positioned: Awaited<ReturnType<ElkGraphLayoutAdapter['layout']>>,
) {
  return {
    width: positioned.width,
    height: positioned.height,
    nodes: positioned.nodes.map(
      ({ id, kind, x, y, width, height, duplicateGroupId }) => ({
        id,
        kind,
        x,
        y,
        width,
        height,
        duplicateGroupId: duplicateGroupId ?? null,
      }),
    ),
    edges: positioned.edges.map(({ id, feedback, points }) => ({
      id,
      feedback,
      points,
    })),
  };
}
