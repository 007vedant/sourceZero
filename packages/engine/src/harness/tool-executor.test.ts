/** Verifies durable, bounded, cancellable, and retry-aware central tool execution. */

import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { createInvestigationId } from '../domain/identifiers.js';
import { SqliteStore } from '../persistence/sqlite-store.js';
import { investigationCreatedDraft } from '../persistence/test-fixtures.js';
import { InMemoryBudgetAccountant } from './budget.js';
import { DurableHarnessEventRecorder } from './event-recorder.js';
import { ToolExecutor, ToolInvocationError } from './tool-executor.js';
import {
  ToolRegistry,
  type ToolDefinition,
  type ToolExecutionContext,
} from './tool-registry.js';

describe('ToolExecutor', () => {
  it('records a successful canonical call and its budget atomically', async () => {
    const harness = await createHarness((input: { query: string }) =>
      Promise.resolve({ result: input.query.toUpperCase() }),
    );

    const outcome = await harness.executor.execute({
      investigationId: harness.investigationId,
      toolName: 'fixture.search',
      input: { query: 'origin' },
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      outcome: 'succeeded',
      attempts: 1,
      output: { result: 'ORIGIN' },
      usage: { searchRequests: 1 },
    });
    expect(harness.eventTypes()).toEqual([
      'investigation.created',
      'tool.requested',
      'tool.started',
      'tool.succeeded',
      'budget.consumed',
    ]);
    harness.store.dispose();
  });

  it('retries a normalized provider failure with durable accounting', async () => {
    const execute = vi
      .fn<(input: { query: string }) => Promise<{ result: string }>>()
      .mockRejectedValueOnce(new Error('transient provider payload'))
      .mockResolvedValueOnce({ result: 'located' });
    const harness = await createHarness(execute, { maxRetries: 1 });

    const outcome = await harness.executor.execute({
      investigationId: harness.investigationId,
      toolName: 'fixture.search',
      input: { query: 'origin' },
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({ outcome: 'succeeded', attempts: 2 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(harness.eventTypes()).toEqual([
      'investigation.created',
      'tool.requested',
      'tool.started',
      'tool.retry_scheduled',
      'tool.started',
      'tool.succeeded',
      'budget.consumed',
    ]);
    expect(harness.budget.snapshot()).toMatchObject({
      searchRequests: 2,
      wallClockMs: 50,
    });
    harness.store.dispose();
  });

  it('distinguishes timeout and propagates its abort signal', async () => {
    let observedAbort = false;
    const harness = await createHarness(
      async (_input, context) =>
        new Promise((resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => {
              observedAbort = true;
              reject(abortError(context.signal));
            },
            { once: true },
          );
        }),
      { timeoutMs: 5 },
    );

    const outcome = await harness.executor.execute({
      investigationId: harness.investigationId,
      toolName: 'fixture.search',
      input: { query: 'origin' },
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      outcome: 'failed',
      attempts: 1,
      failureCode: 'timeout',
    });
    expect(observedAbort).toBe(true);
    harness.store.dispose();
  });

  it('acknowledges cancellation without scheduling another attempt', async () => {
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const execute = vi.fn(
      (_input: { query: string }, context: ToolExecutionContext) =>
        new Promise<{ result: string }>((resolve, reject) => {
          notifyStarted?.();
          context.signal.addEventListener(
            'abort',
            () => reject(abortError(context.signal)),
            { once: true },
          );
        }),
    );
    const harness = await createHarness(execute, { maxRetries: 2 });
    const controller = new AbortController();
    const pending = harness.executor.execute({
      investigationId: harness.investigationId,
      toolName: 'fixture.search',
      input: { query: 'origin' },
      signal: controller.signal,
    });
    await started;
    controller.abort(new Error('user canceled'));

    await expect(pending).resolves.toMatchObject({
      outcome: 'failed',
      attempts: 1,
      failureCode: 'canceled',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(harness.eventTypes()).not.toContain('tool.retry_scheduled');
    harness.store.dispose();
  });

  it('rejects invalid input and exhausted budgets before durable tool events', async () => {
    const invalid = await createHarness(() =>
      Promise.resolve({ result: 'unused' }),
    );
    await expect(
      invalid.executor.execute({
        investigationId: invalid.investigationId,
        toolName: 'fixture.search',
        input: { query: '' },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    } satisfies Partial<ToolInvocationError>);
    expect(invalid.eventTypes()).toEqual(['investigation.created']);
    invalid.store.dispose();

    const exhausted = await createHarness(
      () => Promise.resolve({ result: 'unused' }),
      { maxSearchRequests: 0 },
    );
    await expect(
      exhausted.executor.execute({
        investigationId: exhausted.investigationId,
        toolName: 'fixture.search',
        input: { query: 'origin' },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'budget_exhausted',
    } satisfies Partial<ToolInvocationError>);
    expect(exhausted.eventTypes()).toEqual(['investigation.created']);
    exhausted.store.dispose();
  });

  it('returns preflight cancellation without durable call events', async () => {
    const harness = await createHarness(() =>
      Promise.resolve({ result: 'unused' }),
    );
    const controller = new AbortController();
    controller.abort(new Error('user canceled'));

    await expect(
      harness.executor.execute({
        investigationId: harness.investigationId,
        toolName: 'fixture.search',
        input: { query: 'origin' },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'canceled' });
    expect(harness.eventTypes()).toEqual(['investigation.created']);
    harness.store.dispose();
  });

  it('records invalid provider output only as a structured failure', async () => {
    const harness = await createHarness(() =>
      Promise.resolve({ wrong: true } as unknown as { result: string }),
    );

    await expect(
      harness.executor.execute({
        investigationId: harness.investigationId,
        toolName: 'fixture.search',
        input: { query: 'origin' },
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      outcome: 'failed',
      failureCode: 'invalid_output',
    });
    expect(harness.eventTypes()).not.toContain('tool.succeeded');
    harness.store.dispose();
  });
});

interface HarnessOverrides {
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
  readonly maxSearchRequests?: number;
}

async function createHarness(
  execute: ToolDefinition<{ query: string }, { result: string }>['execute'],
  overrides: HarnessOverrides = {},
) {
  const store = await SqliteStore.open({ databasePath: ':memory:' });
  const investigationId = createInvestigationId();
  store.createInvestigation(investigationId, investigationCreatedDraft());
  const registry = new ToolRegistry();
  registry.register({
    name: 'fixture.search',
    description: 'Returns one deterministic fixture result.',
    inputSchema: z.object({ query: z.string().min(1) }).strict(),
    outputSchema: z.object({ result: z.string().min(1) }).strict(),
    timeoutMs: overrides.timeoutMs ?? 100,
    retryPolicy: {
      maxRetries: overrides.maxRetries ?? 0,
      delayMs: 0,
      retryableFailureCodes: ['provider_failure', 'timeout'],
    },
    budget: { perAttempt: { searchRequests: 1 } },
    execute,
  });
  const budget = new InMemoryBudgetAccountant({
    searchRequests: overrides.maxSearchRequests ?? 10,
    wallClockMs: 10_000,
  });
  let monotonicTime = 0;
  const executor = new ToolExecutor({
    registry,
    recorder: new DurableHarnessEventRecorder({ repository: store }),
    budget,
    monotonicClock: () => {
      monotonicTime += 10;
      return monotonicTime;
    },
    delay: (_milliseconds, signal) => {
      signal.throwIfAborted();
      return Promise.resolve();
    },
  });
  return {
    budget,
    executor,
    investigationId,
    store,
    eventTypes: () =>
      store
        .readInvestigationSnapshot(investigationId, 0)
        .events.map((event) => event.type),
  };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Operation was aborted.');
}
