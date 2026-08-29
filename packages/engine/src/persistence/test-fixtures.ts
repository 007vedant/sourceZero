import {
  EVENT_SCHEMA_VERSION,
  INVESTIGATION_FORMAT_VERSION,
  type InvestigationCreatedEventDraft,
  type InvestigationEventDraft,
} from '../domain/events.js';
import { createEventId } from '../domain/identifiers.js';

export const fixtureTimestamp = '2026-08-28T08:00:00.000Z';

export function investigationCreatedDraft(): InvestigationCreatedEventDraft {
  return {
    eventId: createEventId(),
    type: 'investigation.created',
    occurredAt: fixtureTimestamp,
    schemaVersion: EVENT_SCHEMA_VERSION,
    producer: { kind: 'user', userId: 'fixture-user' },
    data: {
      formatVersion: INVESTIGATION_FORMAT_VERSION,
      originalInput: { kind: 'claim', claim: 'A fixture claim.' },
    },
  };
}

export function policyResolvedDraft(): InvestigationEventDraft {
  return {
    eventId: createEventId(),
    type: 'investigation.policy_resolved',
    occurredAt: fixtureTimestamp,
    schemaVersion: EVENT_SCHEMA_VERSION,
    producer: { kind: 'system', component: 'fixture' },
    data: {
      policy: {
        maxSearchRequests: 10,
        maxRetrievedSources: 25,
        maxTraversalDepth: 3,
        maxModelTokens: 50_000,
        maxWallClockMs: 300_000,
        perToolTimeoutMs: 20_000,
        maxRetries: 2,
        maxGraphNodes: 200,
      },
    },
  };
}

export function statusChangedDraft(
  reason = 'Fixture transition.',
): InvestigationEventDraft {
  return {
    eventId: createEventId(),
    type: 'investigation.status_changed',
    occurredAt: fixtureTimestamp,
    schemaVersion: EVENT_SCHEMA_VERSION,
    producer: { kind: 'system', component: 'fixture' },
    data: { from: 'draft', to: 'awaiting_confirmation', reason },
  };
}
