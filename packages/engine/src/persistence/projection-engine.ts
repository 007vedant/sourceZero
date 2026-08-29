/**
 * Rebuilds pure projections from durable events and disposable versioned checkpoints.
 */

import { z } from 'zod';

import type { ProjectionDefinition } from '../domain/projection.js';
import type { InvestigationId } from '../domain/identifiers.js';
import type { ProjectionRegistry } from '../runtime/projection-registry.js';
import type {
  InvestigationEventSnapshot,
  InvestigationSnapshotReader,
  ProjectionCheckpointRepository,
} from './records.js';

export type ProjectionErrorCode =
  'event_sequence_gap' | 'invalid_projection_state';

/** Reports deterministic replay or projection-state failures. */
export class ProjectionError extends Error {
  public constructor(
    public readonly code: ProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectionError';
  }
}

export interface ProjectionResult<View> {
  readonly view: View;
  readonly lastSequence: number;
  readonly usedCheckpoint: boolean;
}

export interface ProjectionEngineOptions {
  readonly events: InvestigationSnapshotReader;
  readonly checkpoints: ProjectionCheckpointRepository;
  readonly registry: ProjectionRegistry;
  readonly clock?: () => Date;
}

/** Coordinates checkpoint validation, event folding, and checkpoint publication. */
export class ProjectionEngine {
  readonly #events: InvestigationSnapshotReader;
  readonly #checkpoints: ProjectionCheckpointRepository;
  readonly #registry: ProjectionRegistry;
  readonly #clock: () => Date;

  public constructor(options: ProjectionEngineOptions) {
    this.#events = options.events;
    this.#checkpoints = options.checkpoints;
    this.#registry = options.registry;
    this.#clock = options.clock ?? (() => new Date());
  }

  public project<State, View>(
    investigationId: InvestigationId,
    definition: ProjectionDefinition<State, View>,
  ): ProjectionResult<View> {
    return this.#fold(investigationId, definition, true);
  }

  public projectSnapshot<State, View>(
    snapshot: InvestigationEventSnapshot,
    definition: ProjectionDefinition<State, View>,
  ): ProjectionResult<View> {
    return this.#fold(snapshot.investigation.id, definition, true, snapshot);
  }

  public rebuild<State, View>(
    investigationId: InvestigationId,
    definition: ProjectionDefinition<State, View>,
  ): ProjectionResult<View> {
    this.#registry.assertRegistered(definition);
    this.#checkpoints.deleteProjectionCheckpoint(
      investigationId,
      definition.id,
    );
    return this.#fold(investigationId, definition, false);
  }

  #fold<State, View>(
    investigationId: InvestigationId,
    definition: ProjectionDefinition<State, View>,
    allowCheckpoint: boolean,
    fixedSnapshot?: InvestigationEventSnapshot,
  ): ProjectionResult<View> {
    this.#registry.assertRegistered(definition);
    let state = definition.init();
    let watermark = 0;
    let usedCheckpoint = false;

    if (allowCheckpoint) {
      const checkpoint = this.#checkpoints.getProjectionCheckpoint(
        investigationId,
        definition.id,
      );
      if (checkpoint !== undefined) {
        const checkpointState = definition.stateSchema.safeParse(
          checkpoint.state,
        );
        if (
          checkpoint.projectionVersion === definition.version &&
          checkpointState.success
        ) {
          state = checkpointState.data;
          watermark = checkpoint.lastSequence;
          usedCheckpoint = true;
        } else {
          this.#checkpoints.deleteProjectionCheckpoint(
            investigationId,
            definition.id,
          );
        }
      }
    }

    const snapshot =
      fixedSnapshot ??
      this.#events.readInvestigationSnapshot(investigationId, watermark);
    if (watermark > snapshot.investigation.lastSequence) {
      this.#checkpoints.deleteProjectionCheckpoint(
        investigationId,
        definition.id,
      );
      return this.#fold(investigationId, definition, false, fixedSnapshot);
    }

    let expectedSequence = watermark + 1;
    const tail =
      fixedSnapshot === undefined
        ? snapshot.events
        : snapshot.events.filter((event) => event.sequence > watermark);
    for (const event of tail) {
      if (event.sequence !== expectedSequence) {
        throw new ProjectionError(
          'event_sequence_gap',
          `Projection "${definition.id}" expected event sequence ${expectedSequence.toString()} but received ${event.sequence.toString()}.`,
        );
      }
      state = definition.apply(state, event);
      expectedSequence += 1;
    }

    const lastSequence = snapshot.investigation.lastSequence;
    if (expectedSequence !== lastSequence + 1) {
      throw new ProjectionError(
        'event_sequence_gap',
        `Projection "${definition.id}" did not receive every event through sequence ${lastSequence.toString()}.`,
      );
    }
    const validatedState = definition.stateSchema.safeParse(state);
    if (!validatedState.success) {
      throw new ProjectionError(
        'invalid_projection_state',
        `Projection "${definition.id}" produced state that does not match its declared schema.`,
      );
    }
    const serializedState = z.json().safeParse(validatedState.data);
    if (!serializedState.success) {
      throw new ProjectionError(
        'invalid_projection_state',
        `Projection "${definition.id}" produced state that is not plain JSON.`,
      );
    }
    this.#checkpoints.putProjectionCheckpoint({
      investigationId,
      projectionId: definition.id,
      projectionVersion: definition.version,
      lastSequence,
      state: serializedState.data,
      updatedAt: this.#clock().toISOString(),
    });

    return {
      view: definition.view(validatedState.data),
      lastSequence,
      usedCheckpoint,
    };
  }
}
