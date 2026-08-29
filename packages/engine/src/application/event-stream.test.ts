/** Verifies that subscribe-before-read observation merges backlog and live events without gaps. */

import { describe, expect, it } from 'vitest';

import { materializeEvent } from '../domain/events.js';
import { createInvestigationId } from '../domain/identifiers.js';
import type { InvestigationSnapshotReader } from '../persistence/records.js';
import {
  investigationCreatedDraft,
  policyResolvedDraft,
  statusChangedDraft,
} from '../persistence/test-fixtures.js';
import {
  CommittedEventBus,
  GapFreeInvestigationObserver,
} from './event-stream.js';

describe('GapFreeInvestigationObserver', () => {
  it('isolates listener failures after an event has committed', () => {
    const errors: unknown[] = [];
    const investigationId = createInvestigationId();
    const event = materializeEvent(
      investigationId,
      1,
      investigationCreatedDraft(),
    );
    const bus = new CommittedEventBus((error) => errors.push(error));
    bus.subscribe(investigationId, () => {
      throw new Error('renderer failed');
    });

    expect(() => bus.publish([event])).not.toThrow();
    expect(errors).toHaveLength(1);
  });

  it('deduplicates an event committed between subscription and backlog delivery', async () => {
    const investigationId = createInvestigationId();
    const first = materializeEvent(
      investigationId,
      1,
      investigationCreatedDraft(),
    );
    const second = materializeEvent(investigationId, 2, policyResolvedDraft());
    const bus = new CommittedEventBus();
    const reader: InvestigationSnapshotReader = {
      readInvestigationSnapshot() {
        bus.publish([second]);
        return {
          investigation: {
            id: investigationId,
            formatVersion: 1,
            status: 'draft',
            createdAt: first.occurredAt,
            updatedAt: second.occurredAt,
            lastSequence: 2,
          },
          events: [first, second],
        };
      },
    };
    const subscription = new GapFreeInvestigationObserver(reader, bus).observe(
      investigationId,
    );

    await expect(subscription.next()).resolves.toMatchObject({
      done: false,
      value: { sequence: 1 },
    });
    await expect(subscription.next()).resolves.toMatchObject({
      done: false,
      value: { sequence: 2 },
    });
    const third = materializeEvent(investigationId, 3, statusChangedDraft());
    bus.publish([third]);
    await expect(subscription.next()).resolves.toMatchObject({
      done: false,
      value: { sequence: 3 },
    });
    subscription.dispose();
  });

  it('settles a pending read when observation is canceled', async () => {
    const investigationId = createInvestigationId();
    const first = materializeEvent(
      investigationId,
      1,
      investigationCreatedDraft(),
    );
    const controller = new AbortController();
    const reader: InvestigationSnapshotReader = {
      readInvestigationSnapshot: () => ({
        investigation: {
          id: investigationId,
          formatVersion: 1,
          status: 'draft',
          createdAt: first.occurredAt,
          updatedAt: first.occurredAt,
          lastSequence: 1,
        },
        events: [],
      }),
    };
    const subscription = new GapFreeInvestigationObserver(
      reader,
      new CommittedEventBus(),
    ).observe(investigationId, 1, controller.signal);
    const pending = subscription.next();

    controller.abort();

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
  });
});
