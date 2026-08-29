/**
 * Exposes client-safe investigation creation, queries, inspection, and observation.
 */

import type {
  InvestigationListItemView,
  InvestigationWorkspaceView,
  WorkspaceSection,
} from '@sourcezero/presentation';
import { z } from 'zod';

import {
  EVENT_SCHEMA_VERSION,
  INVESTIGATION_FORMAT_VERSION,
  materializeEvent,
  originalInputSchema,
  type InvestigationCreatedEventDraft,
  type InvestigationEvent,
  type InvestigationStatus,
} from '../domain/events.js';
import {
  createEventId,
  createInvestigationId,
  type InvestigationId,
} from '../domain/identifiers.js';
import { ProjectionEngine } from '../persistence/projection-engine.js';
import type {
  InvestigationEventSnapshot,
  InvestigationRecord,
  InvestigationSnapshotReader,
  ProjectionCheckpointRepository,
} from '../persistence/records.js';
import type { ProjectionRegistry } from '../runtime/projection-registry.js';
import {
  budgetProjection,
  graphProjection,
  lifecycleProjection,
  limitationsProjection,
  progressProjection,
  sourceCatalogProjection,
  traceProjection,
} from './foundational-projections.js';
import {
  CommittedEventBus,
  GapFreeInvestigationObserver,
  type InvestigationEventSubscription,
} from './event-stream.js';

const createInvestigationCommandSchema = z
  .object({
    originalInput: originalInputSchema,
    userId: z.string().min(1).optional(),
  })
  .strict();

export type CreateInvestigationCommand = z.infer<
  typeof createInvestigationCommandSchema
>;

export type ApplicationErrorCode =
  'invalid_command' | 'invalid_projection_result';

/** Reports validation or assembly failures at the client-facing service boundary. */
export class ApplicationError extends Error {
  public constructor(
    public readonly code: ApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export interface InvestigationApplicationPersistence
  extends InvestigationSnapshotReader, ProjectionCheckpointRepository {
  createInvestigation(
    investigationId: InvestigationId,
    draft: InvestigationCreatedEventDraft,
  ): InvestigationRecord;
  listInvestigations(): readonly InvestigationRecord[];
}

export interface InvestigationInspection {
  readonly workspace: InvestigationWorkspaceView<
    InvestigationId,
    InvestigationStatus
  >;
  readonly events: readonly InvestigationEvent[];
  readonly projectionWatermarks: Readonly<Record<string, number>>;
}

export interface InvestigationApplicationServiceOptions {
  readonly persistence: InvestigationApplicationPersistence;
  readonly projections: ProjectionRegistry;
  readonly eventBus?: CommittedEventBus;
  readonly clock?: () => Date;
}

/** Coordinates durable application commands and consistent projection-backed queries. */
export class InvestigationApplicationService {
  readonly #persistence: InvestigationApplicationPersistence;
  readonly #projectionEngine: ProjectionEngine;
  readonly #eventBus: CommittedEventBus;
  readonly #observer: GapFreeInvestigationObserver;
  readonly #clock: () => Date;

  public constructor(options: InvestigationApplicationServiceOptions) {
    this.#persistence = options.persistence;
    this.#eventBus = options.eventBus ?? new CommittedEventBus();
    this.#observer = new GapFreeInvestigationObserver(
      options.persistence,
      this.#eventBus,
    );
    this.#clock = options.clock ?? (() => new Date());
    this.#projectionEngine = new ProjectionEngine({
      events: options.persistence,
      checkpoints: options.persistence,
      registry: options.projections,
      clock: this.#clock,
    });
  }

  public createInvestigation(
    command: unknown,
  ): InvestigationWorkspaceView<InvestigationId, InvestigationStatus> {
    const result = createInvestigationCommandSchema.safeParse(command);
    if (!result.success) {
      throw new ApplicationError(
        'invalid_command',
        'Investigation creation command failed runtime validation.',
      );
    }

    const investigationId = createInvestigationId();
    const draft: InvestigationCreatedEventDraft = {
      eventId: createEventId(),
      type: 'investigation.created',
      occurredAt: this.#clock().toISOString(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      producer:
        result.data.userId === undefined
          ? { kind: 'user' }
          : { kind: 'user', userId: result.data.userId },
      data: {
        formatVersion: INVESTIGATION_FORMAT_VERSION,
        originalInput: result.data.originalInput,
      },
    };
    this.#persistence.createInvestigation(investigationId, draft);
    this.#eventBus.publish([materializeEvent(investigationId, 1, draft)]);
    return this.showInvestigation(investigationId);
  }

  public listInvestigations(): readonly InvestigationListItemView<
    InvestigationId,
    InvestigationStatus
  >[] {
    return this.#persistence.listInvestigations().map((record) => ({
      investigationId: record.id,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastSequence: record.lastSequence,
    }));
  }

  public showInvestigation(
    investigationId: InvestigationId,
  ): InvestigationWorkspaceView<InvestigationId, InvestigationStatus> {
    const snapshot = this.#persistence.readInvestigationSnapshot(
      investigationId,
      0,
    );
    return this.#assemble(snapshot).workspace;
  }

  public inspectInvestigation(
    investigationId: InvestigationId,
  ): InvestigationInspection {
    const snapshot = this.#persistence.readInvestigationSnapshot(
      investigationId,
      0,
    );
    const assembled = this.#assemble(snapshot);
    return {
      workspace: assembled.workspace,
      events: snapshot.events,
      projectionWatermarks: assembled.projectionWatermarks,
    };
  }

  public observeInvestigation(
    investigationId: InvestigationId,
    afterSequence = 0,
    signal?: AbortSignal,
  ): InvestigationEventSubscription {
    return this.#observer.observe(investigationId, afterSequence, signal);
  }

  #assemble(snapshot: InvestigationEventSnapshot): InvestigationInspection {
    const lifecycle = this.#projectionEngine.projectSnapshot(
      snapshot,
      lifecycleProjection,
    );
    const progress = this.#projectionEngine.projectSnapshot(
      snapshot,
      progressProjection,
    );
    const budget = this.#projectionEngine.projectSnapshot(
      snapshot,
      budgetProjection,
    );
    const sources = this.#projectionEngine.projectSnapshot(
      snapshot,
      sourceCatalogProjection,
    );
    const graph = this.#projectionEngine.projectSnapshot(
      snapshot,
      graphProjection,
    );
    const limitations = this.#projectionEngine.projectSnapshot(
      snapshot,
      limitationsProjection,
    );
    const trace = this.#projectionEngine.projectSnapshot(
      snapshot,
      traceProjection,
    );
    if (
      lifecycle.view.status === undefined ||
      lifecycle.view.originalInput === undefined ||
      progress.view === undefined
    ) {
      throw new ApplicationError(
        'invalid_projection_result',
        'Foundational projections did not produce an investigation workspace.',
      );
    }

    const workspace: InvestigationWorkspaceView<
      InvestigationId,
      InvestigationStatus
    > = {
      investigationId: snapshot.investigation.id,
      overview: {
        status: lifecycle.view.status,
        originalInput: lifecycle.view.originalInput,
        sourceCount: sources.view.sourceCount,
        relationshipCount: graph.view.edges.length,
      },
      progress: progress.view,
      budget: budget.view,
      graph: graph.view,
      timeline: { entries: [] },
      evidence: { rows: [] },
      limitations: limitations.view,
      trace: trace.view,
      availableActions: workspaceSections.map((section) => ({
        type: 'inspect_section',
        section,
      })),
    };
    return {
      workspace,
      events: snapshot.events,
      projectionWatermarks: Object.fromEntries(
        [
          lifecycleProjection.id,
          progressProjection.id,
          budgetProjection.id,
          sourceCatalogProjection.id,
          graphProjection.id,
          limitationsProjection.id,
          traceProjection.id,
        ].map((id) => [id, snapshot.investigation.lastSequence]),
      ),
    };
  }
}

const workspaceSections: readonly WorkspaceSection[] = [
  'overview',
  'progress',
  'graph',
  'timeline',
  'evidence',
  'limitations',
  'trace',
];
