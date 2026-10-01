/** Verifies foundational projection behavior and unchanged-state reference preservation. */

import { describe, expect, it } from 'vitest';

import { EVENT_SCHEMA_VERSION, materializeEvent } from '../domain/events.js';
import {
  createEventId,
  createInvestigationId,
  createToolCallId,
} from '../domain/identifiers.js';
import {
  investigationCreatedDraft,
  policyResolvedDraft,
} from '../persistence/test-fixtures.js';
import {
  budgetProjection,
  graphProjection,
  lifecycleProjection,
  limitationsProjection,
  progressProjection,
  sourceCatalogProjection,
} from './foundational-projections.js';

describe('foundational projections', () => {
  it('returns the previous state reference for events it does not consume', () => {
    const investigationId = createInvestigationId();
    const policyEvent = materializeEvent(
      investigationId,
      2,
      policyResolvedDraft(),
    );
    const createdEvent = materializeEvent(
      investigationId,
      1,
      investigationCreatedDraft(),
    );

    const lifecycle = lifecycleProjection.init();
    expect(lifecycleProjection.apply(lifecycle, policyEvent)).toBe(lifecycle);
    const progress = progressProjection.init();
    expect(progressProjection.apply(progress, policyEvent)).toBe(progress);
    const budget = budgetProjection.init();
    expect(budgetProjection.apply(budget, createdEvent)).toBe(budget);
    const limitations = limitationsProjection.init();
    expect(limitationsProjection.apply(limitations, createdEvent)).toBe(
      limitations,
    );
    const sources = sourceCatalogProjection.init();
    expect(sourceCatalogProjection.apply(sources, createdEvent)).toBe(sources);
    const graph = graphProjection.init();
    expect(graphProjection.apply(graph, createdEvent)).toBe(graph);
  });

  it('projects durable budget consumption additively', () => {
    const investigationId = createInvestigationId();
    const toolCallId = createToolCallId();
    const event = materializeEvent(investigationId, 2, {
      eventId: createEventId(),
      type: 'budget.consumed',
      occurredAt: '2026-10-01T00:00:00.000Z',
      schemaVersion: EVENT_SCHEMA_VERSION,
      producer: { kind: 'system', component: 'harness.budget' },
      data: {
        toolCallId,
        reason: 'tool:provider.model.complete',
        delta: { modelTokens: 8, wallClockMs: 12 },
      },
    });

    const state = budgetProjection.apply(budgetProjection.init(), event);

    expect(budgetProjection.view(state).usage).toEqual({
      searchRequests: 0,
      retrievedSources: 0,
      modelTokens: 8,
      wallClockMs: 12,
      graphNodes: 0,
    });
  });
});
