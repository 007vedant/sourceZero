/**
 * Bridges committed local events into ordered, gap-free asynchronous subscriptions.
 */

import type { InvestigationEvent } from '../domain/events.js';
import type { InvestigationId } from '../domain/identifiers.js';
import type { InvestigationSnapshotReader } from '../persistence/records.js';
import { toDisposable, type Disposable } from '../runtime/disposable.js';

type EventListener = (event: InvestigationEvent) => void;

/** Publishes events only after their durable transaction has committed. */
export class CommittedEventBus {
  readonly #listeners = new Map<InvestigationId, Set<EventListener>>();
  readonly #onListenerError: (error: unknown) => void;

  public constructor(
    onListenerError: (error: unknown) => void = () => undefined,
  ) {
    this.#onListenerError = onListenerError;
  }

  public subscribe(
    investigationId: InvestigationId,
    listener: EventListener,
  ): Disposable {
    const listeners = this.#listeners.get(investigationId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(investigationId, listeners);
    return toDisposable(() => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#listeners.delete(investigationId);
      }
    });
  }

  public publish(events: readonly InvestigationEvent[]): void {
    for (const event of events) {
      for (const listener of this.#listeners.get(event.investigationId) ?? []) {
        try {
          listener(event);
        } catch (error: unknown) {
          try {
            this.#onListenerError(error);
          } catch {
            // Observation diagnostics cannot invalidate an already committed event.
          }
        }
      }
    }
  }
}

/** Creates subscriptions by attaching live delivery before reading durable backlog. */
export class GapFreeInvestigationObserver {
  readonly #events: InvestigationSnapshotReader;
  readonly #bus: CommittedEventBus;

  public constructor(
    events: InvestigationSnapshotReader,
    bus: CommittedEventBus,
  ) {
    this.#events = events;
    this.#bus = bus;
  }

  public observe(
    investigationId: InvestigationId,
    afterSequence = 0,
    signal?: AbortSignal,
  ): InvestigationEventSubscription {
    const subscription = new InvestigationEventSubscription(
      afterSequence,
      signal,
    );
    const live = this.#bus.subscribe(investigationId, (event) => {
      subscription.push(event);
    });
    subscription.attach(live);
    try {
      const snapshot = this.#events.readInvestigationSnapshot(
        investigationId,
        afterSequence,
      );
      for (const event of snapshot.events) {
        subscription.push(event);
      }
      return subscription;
    } catch (error: unknown) {
      subscription.dispose();
      throw error;
    }
  }
}

/** Orders and deduplicates durable backlog with concurrently committed live events. */
export class InvestigationEventSubscription
  implements
    AsyncIterable<InvestigationEvent>,
    AsyncIterator<InvestigationEvent>,
    Disposable
{
  readonly #buffer = new Map<number, InvestigationEvent>();
  readonly #ready: InvestigationEvent[] = [];
  readonly #waiters: ((result: IteratorResult<InvestigationEvent>) => void)[] =
    [];
  readonly #signal: AbortSignal | undefined;
  #nextSequence: number;
  #live: Disposable | undefined;
  #closed = false;

  public constructor(afterSequence: number, signal?: AbortSignal) {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new TypeError(
        'Observation watermark must be a non-negative integer.',
      );
    }
    this.#nextSequence = afterSequence + 1;
    this.#signal = signal;
    signal?.addEventListener('abort', this.#onAbort, { once: true });
    if (signal?.aborted === true) {
      this.dispose();
    }
  }

  public attach(live: Disposable): void {
    if (this.#closed) {
      void live.dispose();
      return;
    }
    this.#live = live;
  }

  public push(event: InvestigationEvent): void {
    if (this.#closed || event.sequence < this.#nextSequence) {
      return;
    }
    this.#buffer.set(event.sequence, event);
    this.#flushContiguous();
  }

  public next(): Promise<IteratorResult<InvestigationEvent>> {
    const event = this.#ready.shift();
    if (event !== undefined) {
      return Promise.resolve({ done: false, value: event });
    }
    if (this.#closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  public return(): Promise<IteratorResult<InvestigationEvent>> {
    this.dispose();
    return Promise.resolve({ done: true, value: undefined });
  }

  public [Symbol.asyncIterator](): AsyncIterator<InvestigationEvent> {
    return this;
  }

  public dispose(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#signal?.removeEventListener('abort', this.#onAbort);
    void this.#live?.dispose();
    this.#live = undefined;
    this.#buffer.clear();
    this.#ready.length = 0;
    for (const resolve of this.#waiters.splice(0)) {
      resolve({ done: true, value: undefined });
    }
  }

  readonly #onAbort = (): void => {
    this.dispose();
  };

  #flushContiguous(): void {
    let event = this.#buffer.get(this.#nextSequence);
    while (event !== undefined) {
      this.#buffer.delete(this.#nextSequence);
      this.#nextSequence += 1;
      const resolve = this.#waiters.shift();
      if (resolve === undefined) {
        this.#ready.push(event);
      } else {
        resolve({ done: false, value: event });
      }
      event = this.#buffer.get(this.#nextSequence);
    }
  }
}
