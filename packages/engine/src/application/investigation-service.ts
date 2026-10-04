/**
 * Exposes client-safe investigation creation, framing commands, queries, and observation.
 */

import type {
  FramingView,
  InvestigationListItemView,
  InvestigationWorkspaceView,
  WorkspaceSection,
} from '@sourcezero/presentation';
import { z } from 'zod';

import {
  EVENT_SCHEMA_VERSION,
  INVESTIGATION_FORMAT_VERSION,
  claimProposalSchema,
  framingFailureCodeSchema,
  investigationPolicySchema,
  materializeEvent,
  originalInputSchema,
  pageDerivedContextSchema,
  type InvestigationCreatedEventDraft,
  type InvestigationEvent,
  type InvestigationEventDraft,
  type InvestigationPolicy,
  type InvestigationStatus,
} from '../domain/events.js';
import {
  assertClaimEditable,
  assertStatusTransition,
  requiresExplicitReframe,
} from '../domain/investigation-lifecycle.js';
import {
  createClaimId,
  createEventId,
  createInvestigationId,
  claimIdSchema,
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
  framingProjection,
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

const proposalsCommandSchema = z
  .object({
    proposals: z
      .array(claimProposalSchema.omit({ claimId: true }))
      .min(1)
      .max(5),
  })
  .strict();

const editClaimCommandSchema = z
  .object({
    wording: z.string().trim().min(1).max(10_000),
    replacesClaimId: claimIdSchema.optional(),
  })
  .strict();

const confirmClaimCommandSchema = z
  .object({
    claimId: claimIdSchema,
    wording: z.string().trim().min(1).max(10_000),
  })
  .strict();

const framingFailureCommandSchema = z
  .object({
    code: framingFailureCodeSchema,
    stage: z.enum(['fetch', 'extraction', 'proposal']),
    message: z.string().min(1).max(2_000),
  })
  .strict();

const reframeCommandSchema = z
  .object({
    wording: z.string().trim().min(1).max(10_000),
    mode: z.enum(['restart', 'branch']),
  })
  .strict();

export type CreateInvestigationCommand = z.infer<
  typeof createInvestigationCommandSchema
>;

export type ApplicationErrorCode =
  'invalid_command' | 'invalid_projection_result' | 'illegal_action';

/** Reports validation or legal-action failures at the client-facing boundary. */
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
  append(
    investigationId: InvestigationId,
    expectedPreviousSequence: number,
    drafts: readonly InvestigationEventDraft[],
  ): readonly InvestigationEvent[];
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

type ApplicationEventFact = {
  [Draft in InvestigationEventDraft as Draft['type']]: Omit<
    Draft,
    'eventId' | 'occurredAt' | 'schemaVersion'
  >;
}[InvestigationEventDraft['type']];

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
    if (!result.success) this.#invalidCommand('Investigation creation');

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

  public resolvePolicy(
    investigationId: InvestigationId,
    policy: InvestigationPolicy,
  ): InvestigationWorkspaceView<InvestigationId, InvestigationStatus> {
    const parsed = investigationPolicySchema.safeParse(policy);
    if (!parsed.success) this.#invalidCommand('Investigation policy');
    const workspace = this.showInvestigation(investigationId);
    if (workspace.overview.status !== 'draft' || workspace.budget.configured) {
      this.#illegalAction(
        'Policy can be resolved exactly once while framing is a draft.',
      );
    }
    this.#append(investigationId, [
      {
        type: 'investigation.policy_resolved',
        producer: { kind: 'system', component: 'application.claim-framing' },
        data: { policy: parsed.data },
      },
    ]);
    return this.showInvestigation(investigationId);
  }

  public recordPageContext(
    investigationId: InvestigationId,
    context: unknown,
  ): InvestigationWorkspaceView<InvestigationId, InvestigationStatus> {
    const parsed = pageDerivedContextSchema.safeParse(context);
    if (!parsed.success) this.#invalidCommand('Page-derived context');
    this.#assertStatus(investigationId, 'draft');
    this.#append(investigationId, [
      {
        type: 'framing.page_context_recorded',
        producer: { kind: 'system', component: 'application.claim-framing' },
        data: { context: parsed.data },
      },
    ]);
    return this.showInvestigation(investigationId);
  }

  public recordClaimProposals(
    investigationId: InvestigationId,
    command: unknown,
  ): InvestigationWorkspaceView<InvestigationId, InvestigationStatus> {
    const parsed = proposalsCommandSchema.safeParse(command);
    if (!parsed.success) this.#invalidCommand('Claim proposals');
    this.#assertStatus(investigationId, 'draft');
    const proposals = parsed.data.proposals.map((proposal) => ({
      ...proposal,
      claimId: createClaimId(),
    }));
    this.#append(investigationId, [
      {
        type: 'claim.proposals_recorded',
        producer: { kind: 'system', component: 'application.claim-framing' },
        data: { proposals },
      },
      this.#statusFact(
        'draft',
        'awaiting_confirmation',
        'Claim framing produced reviewable proposals.',
      ),
    ]);
    return this.showInvestigation(investigationId);
  }

  public editClaim(
    investigationId: InvestigationId,
    command: unknown,
  ): InvestigationWorkspaceView<InvestigationId, InvestigationStatus> {
    const parsed = editClaimCommandSchema.safeParse(command);
    if (!parsed.success) this.#invalidCommand('Claim edit');
    const workspace = this.showInvestigation(investigationId);
    try {
      assertClaimEditable(workspace.overview.status);
    } catch (error: unknown) {
      this.#illegalAction(
        error instanceof Error ? error.message : 'Claim cannot be edited.',
      );
    }
    const replacesClaimId =
      parsed.data.replacesClaimId ?? workspace.framing.workingClaim?.claimId;
    this.#append(investigationId, [
      {
        type: 'claim.edited',
        producer: { kind: 'user' },
        data: {
          proposal: {
            claimId: createClaimId(),
            wording: parsed.data.wording,
            origin: 'user_edit',
          },
          ...(replacesClaimId === undefined
            ? {}
            : { replacesClaimId: claimIdSchema.parse(replacesClaimId) }),
        },
      },
    ]);
    return this.showInvestigation(investigationId);
  }

  public confirmClaim(
    investigationId: InvestigationId,
    command: unknown,
  ): InvestigationWorkspaceView<InvestigationId, InvestigationStatus> {
    const parsed = confirmClaimCommandSchema.safeParse(command);
    if (!parsed.success) this.#invalidCommand('Claim confirmation');
    const workspace = this.showInvestigation(investigationId);
    this.#assertStatus(investigationId, 'awaiting_confirmation');
    const proposal = workspace.framing.proposals.find(
      (candidate) => candidate.claimId === parsed.data.claimId,
    );
    if (proposal?.wording !== parsed.data.wording) {
      this.#illegalAction(
        'Confirmed claim must exactly match a durable framing proposal or edit.',
      );
    }
    this.#append(investigationId, [
      {
        type: 'claim.confirmed',
        producer: { kind: 'user' },
        data: parsed.data,
      },
      this.#statusFact(
        'awaiting_confirmation',
        'ready',
        'The user confirmed one precise claim.',
      ),
      this.#statusFact(
        'ready',
        'running',
        'The confirmed bounded investigation run started.',
      ),
    ]);
    return this.showInvestigation(investigationId);
  }

  public recordFramingFailure(
    investigationId: InvestigationId,
    command: unknown,
  ): InvestigationWorkspaceView<InvestigationId, InvestigationStatus> {
    const parsed = framingFailureCommandSchema.safeParse(command);
    if (!parsed.success) this.#invalidCommand('Framing failure');
    this.#assertStatus(investigationId, 'draft');
    this.#append(investigationId, [
      {
        type: 'framing.failed',
        producer: { kind: 'system', component: 'application.claim-framing' },
        data: parsed.data,
      },
      this.#statusFact(
        'draft',
        parsed.data.code === 'canceled'
          ? 'canceled'
          : parsed.data.code === 'budget_exhausted'
            ? 'budget_exhausted'
            : 'failed',
        'Claim framing did not complete.',
      ),
    ]);
    return this.showInvestigation(investigationId);
  }

  public reframeClaim(
    investigationId: InvestigationId,
    command: unknown,
  ): InvestigationWorkspaceView<InvestigationId, InvestigationStatus> {
    const parsed = reframeCommandSchema.safeParse(command);
    if (!parsed.success) this.#invalidCommand('Claim reframe');
    const workspace = this.showInvestigation(investigationId);
    if (!requiresExplicitReframe(workspace.overview.status)) {
      this.#illegalAction(
        'Use normal claim editing before substantive work begins.',
      );
    }
    const confirmed = workspace.framing.confirmedClaim;
    if (confirmed === undefined) {
      this.#illegalAction('A confirmed claim is required before reframing.');
    }

    if (parsed.data.mode === 'branch') {
      const parentSequence =
        this.#snapshot(investigationId).investigation.lastSequence;
      const branch = this.createInvestigation({
        originalInput: { kind: 'claim', claim: parsed.data.wording },
      });
      const policy = investigationPolicySchema.parse(workspace.budget.limits);
      this.#append(branch.investigationId, [
        {
          type: 'investigation.branched',
          producer: { kind: 'user' },
          data: { parentInvestigationId: investigationId, parentSequence },
        },
        {
          type: 'investigation.policy_resolved',
          producer: { kind: 'system', component: 'application.claim-framing' },
          data: { policy },
        },
        {
          type: 'claim.proposals_recorded',
          producer: { kind: 'user' },
          data: {
            proposals: [
              {
                claimId: createClaimId(),
                wording: parsed.data.wording,
                origin: 'user_edit',
              },
            ],
          },
        },
        this.#statusFact(
          'draft',
          'awaiting_confirmation',
          'A reframed claim was branched for confirmation.',
        ),
      ]);
      return this.showInvestigation(branch.investigationId);
    }

    const proposal = {
      claimId: createClaimId(),
      wording: parsed.data.wording,
      origin: 'user_edit' as const,
    };
    this.#append(investigationId, [
      {
        type: 'claim.reframed',
        producer: { kind: 'user' },
        data: {
          mode: 'restart',
          proposal,
          replacesClaimId: claimIdSchema.parse(confirmed.claimId),
        },
      },
      this.#statusFact(
        workspace.overview.status,
        'awaiting_confirmation',
        'The user explicitly restarted framing.',
      ),
    ]);
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
    return this.#assemble(this.#snapshot(investigationId)).workspace;
  }

  public inspectInvestigation(
    investigationId: InvestigationId,
  ): InvestigationInspection {
    const snapshot = this.#snapshot(investigationId);
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
    const framing = this.#projectionEngine.projectSnapshot(
      snapshot,
      framingProjection,
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
      framing: framing.view,
      budget: budget.view,
      graph: graph.view,
      timeline: { entries: [] },
      evidence: { rows: [] },
      limitations: limitations.view,
      trace: trace.view,
      availableActions: availableActions(lifecycle.view.status, framing.view),
    };
    const watermark = snapshot.investigation.lastSequence;
    return {
      workspace,
      events: snapshot.events,
      projectionWatermarks: Object.fromEntries(
        [
          lifecycleProjection.id,
          framingProjection.id,
          progressProjection.id,
          budgetProjection.id,
          sourceCatalogProjection.id,
          graphProjection.id,
          limitationsProjection.id,
          traceProjection.id,
        ].map((id) => [id, watermark]),
      ),
    };
  }

  #snapshot(investigationId: InvestigationId): InvestigationEventSnapshot {
    return this.#persistence.readInvestigationSnapshot(investigationId, 0);
  }

  #assertStatus(
    investigationId: InvestigationId,
    expected: InvestigationStatus,
  ): void {
    const actual = this.#snapshot(investigationId).investigation.status;
    if (actual !== expected) {
      this.#illegalAction(
        `Action requires status "${expected}", but investigation is "${actual}".`,
      );
    }
  }

  #append(
    investigationId: InvestigationId,
    facts: readonly ApplicationEventFact[],
  ): void {
    const snapshot = this.#snapshot(investigationId);
    const drafts = facts.map((fact): InvestigationEventDraft => ({
      ...fact,
      eventId: createEventId(),
      occurredAt: this.#clock().toISOString(),
      schemaVersion: EVENT_SCHEMA_VERSION,
    }));
    const committed = this.#persistence.append(
      investigationId,
      snapshot.investigation.lastSequence,
      drafts,
    );
    this.#eventBus.publish(committed);
  }

  #statusFact(
    from: InvestigationStatus,
    to: InvestigationStatus,
    reason: string,
  ): ApplicationEventFact {
    try {
      assertStatusTransition(from, to);
    } catch (error: unknown) {
      this.#illegalAction(
        error instanceof Error ? error.message : 'Illegal status transition.',
      );
    }
    return {
      type: 'investigation.status_changed',
      producer: { kind: 'system', component: 'application.claim-framing' },
      data: { from, to, reason },
    };
  }

  #invalidCommand(label: string): never {
    throw new ApplicationError(
      'invalid_command',
      `${label} command failed runtime validation.`,
    );
  }

  #illegalAction(message: string): never {
    throw new ApplicationError('illegal_action', message);
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

function availableActions(
  status: InvestigationStatus,
  framing: FramingView,
): InvestigationWorkspaceView['availableActions'] {
  const inspect = workspaceSections.map((section) => ({
    type: 'inspect_section' as const,
    section,
  }));
  if (status === 'awaiting_confirmation') {
    return [
      ...inspect,
      { type: 'edit_claim' },
      ...(framing.workingClaim === undefined
        ? []
        : [{ type: 'confirm_claim' as const }]),
    ];
  }
  if (requiresExplicitReframe(status)) {
    return [
      ...inspect,
      { type: 'restart_framing' },
      { type: 'branch_investigation' },
    ];
  }
  return inspect;
}
