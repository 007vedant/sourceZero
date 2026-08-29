/** Verifies replay, checkpoint reuse, invalidation, and gap detection. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { materializeEvent } from '../domain/events.js';
import { createInvestigationId } from '../domain/identifiers.js';
import type { ProjectionDefinition } from '../domain/projection.js';
import { ProjectionRegistry } from '../runtime/projection-registry.js';
import { ProjectionEngine } from './projection-engine.js';
import type {
  InvestigationSnapshotReader,
  ProjectionCheckpoint,
  ProjectionCheckpointRepository,
} from './records.js';
import { SqliteStore } from './sqlite-store.js';
import {
  investigationCreatedDraft,
  policyResolvedDraft,
  statusChangedDraft,
} from './test-fixtures.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function openStore(): Promise<SqliteStore> {
  const directory = await mkdtemp(join(tmpdir(), 'sourcezero-projections-'));
  temporaryDirectories.push(directory);
  return SqliteStore.open({ databasePath: join(directory, 'sourcezero.db') });
}

const countStateSchema = z.object({ count: z.number().int().nonnegative() });

function countProjection(
  version: number,
  initialCount = 0,
): ProjectionDefinition<{ count: number }, number> {
  return {
    id: 'test.event-count',
    version,
    stateSchema: countStateSchema,
    init: () => ({ count: initialCount }),
    apply: (state) => ({ count: state.count + 1 }),
    view: (state) => state.count,
  };
}

describe('ProjectionEngine', () => {
  it('makes checkpoint-plus-tail replay equivalent to full rebuild', async () => {
    const store = await openStore();
    const investigationId = createInvestigationId();
    store.createInvestigation(investigationId, investigationCreatedDraft());
    store.append(investigationId, 1, [policyResolvedDraft()]);
    const registry = new ProjectionRegistry();
    const projection = countProjection(1);
    registry.register('test', projection);
    const engine = new ProjectionEngine({
      events: store,
      checkpoints: store,
      registry,
    });

    expect(engine.project(investigationId, projection)).toMatchObject({
      view: 2,
      lastSequence: 2,
      usedCheckpoint: false,
    });
    store.append(investigationId, 2, [statusChangedDraft()]);
    const checkpointPlusTail = engine.project(investigationId, projection);
    const fullReplay = engine.rebuild(investigationId, projection);

    expect(checkpointPlusTail).toMatchObject({
      view: 3,
      lastSequence: 3,
      usedCheckpoint: true,
    });
    expect(fullReplay.view).toBe(checkpointPlusTail.view);
    store.dispose();
    registry.dispose();
  });

  it('invalidates a checkpoint when the projection version changes', async () => {
    const store = await openStore();
    const investigationId = createInvestigationId();
    store.createInvestigation(investigationId, investigationCreatedDraft());
    const registry = new ProjectionRegistry();
    const versionOne = countProjection(1);
    const registration = registry.register('test', versionOne);
    const engine = new ProjectionEngine({
      events: store,
      checkpoints: store,
      registry,
    });
    engine.project(investigationId, versionOne);
    await registration.dispose();
    const versionTwo = countProjection(2, 10);
    registry.register('test', versionTwo);

    expect(engine.project(investigationId, versionTwo)).toMatchObject({
      view: 11,
      usedCheckpoint: false,
    });
    expect(
      store.getProjectionCheckpoint(investigationId, versionTwo.id),
    ).toMatchObject({ projectionVersion: 2, lastSequence: 1 });
    store.dispose();
    registry.dispose();
  });

  it('rejects a non-contiguous event snapshot', () => {
    const investigationId = createInvestigationId();
    const first = materializeEvent(
      investigationId,
      1,
      investigationCreatedDraft(),
    );
    const third = materializeEvent(investigationId, 3, policyResolvedDraft());
    const events: InvestigationSnapshotReader = {
      readInvestigationSnapshot: () => ({
        investigation: {
          id: investigationId,
          formatVersion: 1,
          status: 'draft',
          createdAt: first.occurredAt,
          updatedAt: third.occurredAt,
          lastSequence: 3,
        },
        events: [first, third],
      }),
    };
    const checkpoints = memoryCheckpoints();
    const registry = new ProjectionRegistry();
    const projection = countProjection(1);
    registry.register('test', projection);
    const engine = new ProjectionEngine({ events, checkpoints, registry });

    expect(() => engine.project(investigationId, projection)).toThrowError(
      expect.objectContaining({ code: 'event_sequence_gap' }),
    );
    registry.dispose();
  });

  it('rejects folded state that violates the projection schema', () => {
    const investigationId = createInvestigationId();
    const first = materializeEvent(
      investigationId,
      1,
      investigationCreatedDraft(),
    );
    const events: InvestigationSnapshotReader = {
      readInvestigationSnapshot: () => ({
        investigation: {
          id: investigationId,
          formatVersion: 1,
          status: 'draft',
          createdAt: first.occurredAt,
          updatedAt: first.occurredAt,
          lastSequence: 1,
        },
        events: [first],
      }),
    };
    const checkpoints = memoryCheckpoints();
    const registry = new ProjectionRegistry();
    const projection: ProjectionDefinition<{ count: number }, number> = {
      id: 'test.invalid-state',
      version: 1,
      stateSchema: countStateSchema,
      init: () => ({ count: 0 }),
      apply: () => ({ count: -1 }),
      view: (state) => state.count,
    };
    registry.register('test', projection);
    const engine = new ProjectionEngine({ events, checkpoints, registry });

    expect(() => engine.project(investigationId, projection)).toThrowError(
      expect.objectContaining({ code: 'invalid_projection_state' }),
    );
    expect(
      checkpoints.getProjectionCheckpoint(investigationId, projection.id),
    ).toBeUndefined();
    registry.dispose();
  });
});

function memoryCheckpoints(): ProjectionCheckpointRepository {
  const records = new Map<string, ProjectionCheckpoint>();
  return {
    getProjectionCheckpoint: (_investigationId, projectionId) =>
      records.get(projectionId),
    putProjectionCheckpoint: (checkpoint) => {
      records.set(checkpoint.projectionId, checkpoint);
    },
    deleteProjectionCheckpoint: (_investigationId, projectionId) => {
      records.delete(projectionId);
    },
  };
}
