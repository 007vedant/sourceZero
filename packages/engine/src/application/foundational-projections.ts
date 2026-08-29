/**
 * Supplies the first deterministic lifecycle, progress, budget, trace, and empty graph foundations.
 */

import type {
  BudgetView,
  LimitationsView,
  ProgressView,
  ProvenanceGraphView,
  TraceView,
} from '@sourcezero/presentation';
import { z } from 'zod';

import {
  investigationPolicySchema,
  investigationStatusSchema,
  originalInputSchema,
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

const budgetStateSchema = z
  .object({
    policy: investigationPolicySchema.optional(),
    usage: budgetUsageSchema,
  })
  .strict();

type BudgetState = z.infer<typeof budgetStateSchema>;

const emptyBudgetUsage = {
  searchRequests: 0,
  retrievedSources: 0,
  modelTokens: 0,
  wallClockMs: 0,
  graphNodes: 0,
} as const;

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
        return state;
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
