/**
 * Supplies the first deterministic lifecycle, progress, budget, trace, and empty graph foundations.
 */

import type {
  BudgetView,
  FramingView,
  LimitationsView,
  ProgressView,
  ProvenanceGraphView,
  TraceView,
} from '@sourcezero/presentation';
import { z } from 'zod';

import {
  claimProposalSchema,
  framingFailureCodeSchema,
  investigationPolicySchema,
  investigationStatusSchema,
  originalInputSchema,
  pageDerivedContextSchema,
  type BudgetDelta,
  type InvestigationStatus,
  type OriginalInput,
} from '../domain/events.js';
import type { ProjectionDefinition } from '../domain/projection.js';
import type { Plugin } from '../runtime/plugin-runtime.js';

const lifecycleStateSchema = z
  .object({
    status: investigationStatusSchema.optional(),
    originalInput: originalInputSchema.optional(),
  })
  .strict();

type LifecycleState = z.infer<typeof lifecycleStateSchema>;

export interface LifecycleProjectionView {
  readonly status: InvestigationStatus | undefined;
  readonly originalInput: OriginalInput | undefined;
}

export const lifecycleProjection: ProjectionDefinition<
  LifecycleState,
  LifecycleProjectionView
> = {
  id: 'sourcezero.lifecycle',
  version: 1,
  stateSchema: lifecycleStateSchema,
  init: () => ({}),
  apply(state, event) {
    switch (event.type) {
      case 'investigation.created':
        return {
          status: 'draft',
          originalInput: event.data.originalInput,
        };
      case 'investigation.status_changed':
        return { ...state, status: event.data.to };
      case 'investigation.policy_resolved':
      case 'investigation.branched':
      case 'claim.proposals_recorded':
      case 'claim.edited':
      case 'claim.confirmed':
      case 'claim.reframed':
      case 'framing.page_context_recorded':
      case 'framing.failed':
      case 'tool.requested':
      case 'tool.started':
      case 'tool.retry_scheduled':
      case 'tool.succeeded':
      case 'tool.failed':
      case 'budget.consumed':
        return state;
    }
  },
  view: (state) => ({
    status: state.status,
    originalInput: state.originalInput,
  }),
};

const progressStateSchema = z
  .object({ status: investigationStatusSchema.optional() })
  .strict();

type ProgressState = z.infer<typeof progressStateSchema>;

export const progressProjection: ProjectionDefinition<
  ProgressState,
  ProgressView<InvestigationStatus> | undefined
> = {
  id: 'sourcezero.progress',
  version: 1,
  stateSchema: progressStateSchema,
  init: () => ({}),
  apply(state, event) {
    switch (event.type) {
      case 'investigation.created':
        return { status: 'draft' };
      case 'investigation.status_changed':
        return { status: event.data.to };
      case 'investigation.policy_resolved':
      case 'investigation.branched':
      case 'claim.proposals_recorded':
      case 'claim.edited':
      case 'claim.confirmed':
      case 'claim.reframed':
      case 'framing.page_context_recorded':
      case 'framing.failed':
      case 'tool.requested':
      case 'tool.started':
      case 'tool.retry_scheduled':
      case 'tool.succeeded':
      case 'tool.failed':
      case 'budget.consumed':
        return state;
    }
  },
  view: (state) =>
    state.status === undefined
      ? undefined
      : { status: state.status, stage: stageForStatus(state.status) },
};

const budgetUsageSchema = z
  .object({
    searchRequests: z.number().int().nonnegative(),
    retrievedSources: z.number().int().nonnegative(),
    modelTokens: z.number().int().nonnegative(),
    wallClockMs: z.number().int().nonnegative(),
    graphNodes: z.number().int().nonnegative(),
  })
  .strict();

type BudgetUsage = z.infer<typeof budgetUsageSchema>;

const budgetStateSchema = z
  .object({
    policy: investigationPolicySchema.optional(),
    usage: budgetUsageSchema,
  })
  .strict();

type BudgetState = z.infer<typeof budgetStateSchema>;

const emptyBudgetUsage: BudgetUsage = {
  searchRequests: 0,
  retrievedSources: 0,
  modelTokens: 0,
  wallClockMs: 0,
  graphNodes: 0,
};

export const budgetProjection: ProjectionDefinition<BudgetState, BudgetView> = {
  id: 'sourcezero.budget',
  version: 1,
  stateSchema: budgetStateSchema,
  init: () => ({ usage: emptyBudgetUsage }),
  apply(state, event) {
    switch (event.type) {
      case 'investigation.policy_resolved':
        return { ...state, policy: event.data.policy };
      case 'investigation.created':
      case 'investigation.status_changed':
      case 'investigation.branched':
      case 'claim.proposals_recorded':
      case 'claim.edited':
      case 'claim.confirmed':
      case 'claim.reframed':
      case 'framing.page_context_recorded':
      case 'framing.failed':
      case 'tool.requested':
      case 'tool.started':
      case 'tool.retry_scheduled':
      case 'tool.succeeded':
      case 'tool.failed':
        return state;
      case 'budget.consumed':
        return {
          ...state,
          usage: addBudgetDelta(state.usage, event.data.delta),
        };
    }
  },
  view(state) {
    return {
      configured: state.policy !== undefined,
      limits: state.policy === undefined ? {} : { ...state.policy },
      usage: state.usage,
    };
  },
};

const framingStateSchema = z
  .object({
    proposals: z.array(claimProposalSchema),
    workingClaim: claimProposalSchema.optional(),
    confirmedClaim: claimProposalSchema.optional(),
    pageContext: pageDerivedContextSchema.optional(),
    failure: z
      .object({
        code: framingFailureCodeSchema,
        stage: z.enum(['fetch', 'extraction', 'proposal']),
        message: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();

type FramingState = z.infer<typeof framingStateSchema>;

export const framingProjection: ProjectionDefinition<
  FramingState,
  FramingView
> = {
  id: 'sourcezero.framing',
  version: 1,
  stateSchema: framingStateSchema,
  init: () => ({ proposals: [] }),
  apply(state, event) {
    switch (event.type) {
      case 'claim.proposals_recorded': {
        return {
          proposals: [...event.data.proposals],
          workingClaim: event.data.proposals[0],
          ...(state.pageContext === undefined
            ? {}
            : { pageContext: state.pageContext }),
        };
      }
      case 'claim.edited':
      case 'claim.reframed': {
        return {
          proposals: [...state.proposals, event.data.proposal],
          workingClaim: event.data.proposal,
          ...(state.pageContext === undefined
            ? {}
            : { pageContext: state.pageContext }),
        };
      }
      case 'claim.confirmed':
        return {
          ...state,
          confirmedClaim: {
            claimId: event.data.claimId,
            wording: event.data.wording,
            origin: state.workingClaim?.origin ?? 'user_edit',
          },
        };
      case 'framing.page_context_recorded':
        return { ...state, pageContext: event.data.context };
      case 'framing.failed':
        return { ...state, failure: event.data };
      case 'investigation.created':
      case 'investigation.policy_resolved':
      case 'investigation.status_changed':
      case 'investigation.branched':
      case 'tool.requested':
      case 'tool.started':
      case 'tool.retry_scheduled':
      case 'tool.succeeded':
      case 'tool.failed':
      case 'budget.consumed':
        return state;
    }
  },
  view: (state) => ({
    proposals: state.proposals,
    ...(state.workingClaim === undefined
      ? {}
      : {
          workingClaim: {
            claimId: state.workingClaim.claimId,
            wording: state.workingClaim.wording,
          },
        }),
    ...(state.confirmedClaim === undefined
      ? {}
      : {
          confirmedClaim: {
            claimId: state.confirmedClaim.claimId,
            wording: state.confirmedClaim.wording,
          },
        }),
    ...(state.pageContext === undefined
      ? {}
      : {
          pageContext: {
            requestedUrl: state.pageContext.requestedUrl,
            resolvedUrl: state.pageContext.resolvedUrl,
            ...(state.pageContext.title === undefined
              ? {}
              : { title: state.pageContext.title }),
            fetchedArtifactId: state.pageContext.fetchedArtifactId,
            readableTextArtifactId: state.pageContext.readableTextArtifactId,
            readableCharacterCount: state.pageContext.readableCharacterCount,
          },
        }),
    ...(state.failure === undefined ? {} : { failure: state.failure }),
  }),
};

const traceEntrySchema = z
  .object({
    eventId: z.string(),
    sequence: z.number().int().positive(),
    type: z.string(),
    occurredAt: z.string(),
    producerKind: z.enum(['user', 'system', 'model', 'tool']),
  })
  .strict();

const traceStateSchema = z
  .object({ entries: z.array(traceEntrySchema) })
  .strict();
type TraceState = z.infer<typeof traceStateSchema>;

export const traceProjection: ProjectionDefinition<TraceState, TraceView> = {
  id: 'sourcezero.trace',
  version: 1,
  stateSchema: traceStateSchema,
  init: () => ({ entries: [] }),
  apply: (state, event) => ({
    entries: [
      ...state.entries,
      {
        eventId: event.eventId,
        sequence: event.sequence,
        type: event.type,
        occurredAt: event.occurredAt,
        producerKind: event.producer.kind,
      },
    ],
  }),
  view: (state) => state,
};

const limitationsStateSchema = z.object({ items: z.array(z.never()) }).strict();
type LimitationsState = z.infer<typeof limitationsStateSchema>;

export const limitationsProjection: ProjectionDefinition<
  LimitationsState,
  LimitationsView
> = {
  id: 'sourcezero.limitations',
  version: 1,
  stateSchema: limitationsStateSchema,
  init: () => ({ items: [] }),
  apply: (state) => state,
  view: (state) => state,
};

const sourceCatalogStateSchema = z
  .object({ sources: z.array(z.never()) })
  .strict();
type SourceCatalogState = z.infer<typeof sourceCatalogStateSchema>;

export interface SourceCatalogView {
  readonly sourceCount: number;
}

export const sourceCatalogProjection: ProjectionDefinition<
  SourceCatalogState,
  SourceCatalogView
> = {
  id: 'sourcezero.sources',
  version: 1,
  stateSchema: sourceCatalogStateSchema,
  init: () => ({ sources: [] }),
  apply: (state) => state,
  view: (state) => ({ sourceCount: state.sources.length }),
};

const graphStateSchema = z
  .object({ nodes: z.array(z.never()), edges: z.array(z.never()) })
  .strict();
type GraphState = z.infer<typeof graphStateSchema>;

export const graphProjection: ProjectionDefinition<
  GraphState,
  ProvenanceGraphView
> = {
  id: 'sourcezero.graph',
  version: 1,
  stateSchema: graphStateSchema,
  init: () => ({ nodes: [], edges: [] }),
  apply: (state) => state,
  view: (state) => state,
};

export const foundationalProjections = [
  lifecycleProjection,
  framingProjection,
  progressProjection,
  budgetProjection,
  traceProjection,
  limitationsProjection,
  sourceCatalogProjection,
  graphProjection,
] as const;

export const foundationalProjectionsPlugin: Plugin = {
  id: 'sourcezero.foundational-projections',
  setup(context) {
    context.registerProjection(lifecycleProjection);
    context.registerProjection(framingProjection);
    context.registerProjection(progressProjection);
    context.registerProjection(budgetProjection);
    context.registerProjection(traceProjection);
    context.registerProjection(limitationsProjection);
    context.registerProjection(sourceCatalogProjection);
    context.registerProjection(graphProjection);
  },
};

function stageForStatus(status: InvestigationStatus): ProgressView['stage'] {
  switch (status) {
    case 'draft':
    case 'awaiting_confirmation':
      return 'framing';
    case 'ready':
      return 'ready';
    case 'running':
      return 'investigating';
    case 'completed':
      return 'finished';
    case 'canceled':
    case 'failed':
    case 'budget_exhausted':
    case 'interrupted':
      return 'stopped';
  }
}

function addBudgetDelta(usage: BudgetUsage, delta: BudgetDelta): BudgetUsage {
  return {
    searchRequests: usage.searchRequests + (delta.searchRequests ?? 0),
    retrievedSources: usage.retrievedSources + (delta.retrievedSources ?? 0),
    modelTokens: usage.modelTokens + (delta.modelTokens ?? 0),
    wallClockMs: usage.wallClockMs + (delta.wallClockMs ?? 0),
    graphNodes: usage.graphNodes + (delta.graphNodes ?? 0),
  };
}
