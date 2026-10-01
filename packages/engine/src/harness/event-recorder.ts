/**
 * Appends harness facts as validated contiguous investigation events.
 */

import {
  EVENT_SCHEMA_VERSION,
  type InvestigationEvent,
  type InvestigationEventDraft,
} from '../domain/events.js';
import { createEventId, type InvestigationId } from '../domain/identifiers.js';
import type {
  InvestigationEventSnapshot,
  InvestigationSnapshotReader,
} from '../persistence/records.js';

export type HarnessEventFact = {
  [Draft in InvestigationEventDraft as Draft['type']]: Omit<
    Draft,
    'eventId' | 'occurredAt' | 'schemaVersion'
  >;
}[InvestigationEventDraft['type']];

export interface HarnessEventRecorder {
  append(
    investigationId: InvestigationId,
    facts: readonly HarnessEventFact[],
  ): readonly InvestigationEvent[];
}

export interface HarnessEventRepository extends InvestigationSnapshotReader {
  append(
    investigationId: InvestigationId,
    expectedPreviousSequence: number,
    drafts: readonly InvestigationEventDraft[],
  ): readonly InvestigationEvent[];
}

export interface DurableHarnessEventRecorderOptions {
  readonly repository: HarnessEventRepository;
  readonly clock?: () => Date;
  readonly onCommitted?: (events: readonly InvestigationEvent[]) => void;
}

/** Materializes event envelopes and commits them through the durable repository. */
export class DurableHarnessEventRecorder implements HarnessEventRecorder {
  readonly #repository: HarnessEventRepository;
  readonly #clock: () => Date;
  readonly #onCommitted: (events: readonly InvestigationEvent[]) => void;

  public constructor(options: DurableHarnessEventRecorderOptions) {
    this.#repository = options.repository;
    this.#clock = options.clock ?? (() => new Date());
    this.#onCommitted = options.onCommitted ?? (() => undefined);
  }

  public append(
    investigationId: InvestigationId,
    facts: readonly HarnessEventFact[],
  ): readonly InvestigationEvent[] {
    if (facts.length === 0) return [];
    const snapshot: InvestigationEventSnapshot =
      this.#repository.readInvestigationSnapshot(investigationId, 0);
    const drafts = facts.map((fact): InvestigationEventDraft => ({
      ...fact,
      eventId: createEventId(),
      occurredAt: this.#clock().toISOString(),
      schemaVersion: EVENT_SCHEMA_VERSION,
    }));
    const committed = this.#repository.append(
      investigationId,
      snapshot.investigation.lastSequence,
      drafts,
    );
    this.#onCommitted(committed);
    return committed;
  }
}
