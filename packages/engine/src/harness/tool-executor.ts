/**
 * Executes validated tools with identity, budgets, cancellation, retries, and durable outcomes.
 */

import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';

import { z } from 'zod';

import type { BudgetDelta, ToolFailureCode } from '../domain/events.js';
import {
  createToolCallId,
  type InvestigationId,
  type ToolCallId,
} from '../domain/identifiers.js';
import type { BudgetAccountant, BudgetReservation } from './budget.js';
import { BudgetExhaustedError } from './budget.js';
import type {
  HarnessEventFact,
  HarnessEventRecorder,
} from './event-recorder.js';
import type { RegisteredTool } from './tool-registry.js';
import { ToolRegistry } from './tool-registry.js';

export type ToolInvocationErrorCode =
  'invalid_input' | 'input_too_large' | 'budget_exhausted' | 'canceled';

/** Reports a rejection that occurs before any tool work or durable call event. */
export class ToolInvocationError extends Error {
  public constructor(
    public readonly code: ToolInvocationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ToolInvocationError';
  }
}

export type ToolExecutionOutcome =
  | {
      readonly outcome: 'succeeded';
      readonly toolCallId: ToolCallId;
      readonly attempts: number;
      readonly output: z.infer<typeof jsonValueSchema>;
      readonly usage: BudgetDelta;
    }
  | {
      readonly outcome: 'failed';
      readonly toolCallId: ToolCallId;
      readonly attempts: number;
      readonly failureCode: ToolFailureCode;
      readonly usage: BudgetDelta;
    };

export interface ExecuteToolRequest {
  readonly investigationId: InvestigationId;
  readonly toolName: string;
  readonly input: unknown;
  readonly signal: AbortSignal;
}

export interface ToolExecutorOptions {
  readonly registry: ToolRegistry;
  readonly recorder: HarnessEventRecorder;
  readonly budget: BudgetAccountant;
  readonly monotonicClock?: () => number;
  readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface AttemptResult {
  readonly output?: unknown;
  readonly failureCode?: ToolFailureCode;
  readonly durationMs: number;
}

class ToolDeadlineError extends Error {
  public constructor() {
    super('Tool deadline exceeded.');
    this.name = 'ToolDeadlineError';
  }
}

class DelayCanceledError extends Error {
  public constructor(reason: unknown) {
    super('Retry delay was canceled.', {
      cause: reason instanceof Error ? reason : undefined,
    });
    this.name = 'DelayCanceledError';
  }
}

const jsonValueSchema = z.json();

/** Centralizes all integrity-sensitive behavior around registered tool calls. */
export class ToolExecutor {
  readonly #registry: ToolRegistry;
  readonly #recorder: HarnessEventRecorder;
  readonly #budget: BudgetAccountant;
  readonly #now: () => number;
  readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  public constructor(options: ToolExecutorOptions) {
    this.#registry = options.registry;
    this.#recorder = options.recorder;
    this.#budget = options.budget;
    this.#now = options.monotonicClock ?? (() => performance.now());
    this.#delay = options.delay ?? abortableDelay;
  }

  public async execute(
    request: ExecuteToolRequest,
  ): Promise<ToolExecutionOutcome> {
    if (request.signal.aborted) {
      throw new ToolInvocationError(
        'canceled',
        'Tool invocation was canceled before work began.',
      );
    }
    const tool = this.#registry.get(request.toolName);
    const parsedInput = tool.inputSchema.safeParse(request.input);
    if (!parsedInput.success) {
      throw new ToolInvocationError(
        'invalid_input',
        `Input for tool "${tool.name}" failed runtime validation.`,
      );
    }
    const input = canonicalJson(
      parsedInput.data,
      tool.maxInputBytes,
      'input_too_large',
    );
    const maxAttempts = tool.retryPolicy.maxRetries + 1;
    let reservation: BudgetReservation;
    try {
      reservation = this.#budget.reserve(
        estimatedUsage(tool, input, maxAttempts),
      );
    } catch (error: unknown) {
      if (error instanceof BudgetExhaustedError) {
        throw new ToolInvocationError('budget_exhausted', error.message, {
          cause: error,
        });
      }
      throw error;
    }

    const toolCallId = createToolCallId();
    const callStartedAt = this.#now();
    let attempts = 0;
    try {
      const requested = this.#recorder.append(request.investigationId, [
        {
          type: 'tool.requested',
          producer: { kind: 'system', component: 'harness.tool-executor' },
          data: {
            toolCallId,
            toolName: tool.name,
            input,
            timeoutMs: tool.timeoutMs,
            maxAttempts,
          },
        },
      ]);
      const causationId = requested[0]?.eventId;
      if (causationId === undefined) {
        throw new Error('Tool request event was not committed.');
      }

      while (attempts < maxAttempts) {
        request.signal.throwIfAborted();
        attempts += 1;
        this.#recorder.append(request.investigationId, [
          startedFact(tool, toolCallId, attempts, causationId),
        ]);
        const attempt = await runAttempt(
          tool,
          input,
          toolCallId,
          attempts,
          request.signal,
          this.#now,
        );
        let failureCode = attempt.failureCode;
        let output: z.infer<typeof jsonValueSchema> | undefined;
        if (failureCode === undefined) {
          const parsedOutput = tool.outputSchema.safeParse(attempt.output);
          if (!parsedOutput.success) {
            failureCode = 'invalid_output';
          } else {
            try {
              output = canonicalJson(
                parsedOutput.data,
                tool.maxOutputBytes,
                'invalid_output',
              );
            } catch (error: unknown) {
              if (
                error instanceof ToolInvocationError &&
                error.code === 'input_too_large'
              ) {
                failureCode = 'invalid_output';
              } else {
                throw error;
              }
            }
          }
        }
        if (failureCode === undefined && output !== undefined) {
          const usage = actualUsage(
            tool,
            input,
            output,
            attempts,
            elapsed(this.#now, callStartedAt),
          );
          const terminalFacts: HarnessEventFact[] = [
            {
              type: 'tool.succeeded',
              producer: { kind: 'tool', toolName: tool.name, toolCallId },
              causationId,
              data: {
                toolCallId,
                toolName: tool.name,
                attempt: attempts,
                durationMs: attempt.durationMs,
                output,
              },
            },
            budgetFact(toolCallId, tool.name, usage, causationId),
          ];
          this.#recorder.append(request.investigationId, terminalFacts);
          reservation.commit(usage);
          return { outcome: 'succeeded', toolCallId, attempts, output, usage };
        }
        const resolvedFailure = failureCode ?? 'provider_failure';
        if (
          resolvedFailure !== 'canceled' &&
          attempts < maxAttempts &&
          tool.retryPolicy.retryableFailureCodes.includes(resolvedFailure)
        ) {
          this.#recorder.append(request.investigationId, [
            {
              type: 'tool.retry_scheduled',
              producer: { kind: 'system', component: 'harness.tool-executor' },
              causationId,
              data: {
                toolCallId,
                toolName: tool.name,
                failedAttempt: attempts,
                nextAttempt: attempts + 1,
                delayMs: tool.retryPolicy.delayMs,
                failureCode: resolvedFailure,
              },
            },
          ]);
          try {
            await this.#delay(tool.retryPolicy.delayMs, request.signal);
            continue;
          } catch (error: unknown) {
            if (
              !(error instanceof DelayCanceledError) &&
              error !== request.signal.reason
            ) {
              throw error;
            }
            failureCode = 'canceled';
          }
        }
        const finalFailure = failureCode ?? resolvedFailure;
        const usage = actualUsage(
          tool,
          input,
          undefined,
          attempts,
          elapsed(this.#now, callStartedAt),
        );
        this.#recorder.append(request.investigationId, [
          {
            type: 'tool.failed',
            producer: { kind: 'tool', toolName: tool.name, toolCallId },
            causationId,
            data: {
              toolCallId,
              toolName: tool.name,
              attempt: attempts,
              durationMs: attempt.durationMs,
              failureCode: finalFailure,
            },
          },
          budgetFact(toolCallId, tool.name, usage, causationId),
        ]);
        reservation.commit(usage);
        return {
          outcome: 'failed',
          toolCallId,
          attempts,
          failureCode: finalFailure,
          usage,
        };
      }
      throw new Error('Tool executor exhausted attempts without an outcome.');
    } catch (error: unknown) {
      reservation.release();
      throw error;
    }
  }
}

function startedFact(
  tool: RegisteredTool,
  toolCallId: ToolCallId,
  attempt: number,
  causationId: HarnessEventFact['causationId'],
): HarnessEventFact {
  return {
    type: 'tool.started',
    producer: { kind: 'system', component: 'harness.tool-executor' },
    causationId,
    data: { toolCallId, toolName: tool.name, attempt },
  };
}

function budgetFact(
  toolCallId: ToolCallId,
  toolName: string,
  delta: BudgetDelta,
  causationId: HarnessEventFact['causationId'],
): HarnessEventFact {
  return {
    type: 'budget.consumed',
    producer: { kind: 'system', component: 'harness.budget' },
    causationId,
    data: { toolCallId, reason: `tool:${toolName}`, delta },
  };
}

async function runAttempt(
  tool: RegisteredTool,
  input: unknown,
  toolCallId: ToolCallId,
  attempt: number,
  investigationSignal: AbortSignal,
  now: () => number,
): Promise<AttemptResult> {
  const controller = new AbortController();
  const startedAt = now();
  const cancel = () => controller.abort(investigationSignal.reason);
  investigationSignal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new ToolDeadlineError());
  }, tool.timeoutMs);
  try {
    const output = await tool.execute(input, {
      signal: controller.signal,
      toolCallId,
      attempt,
    });
    return { output, durationMs: elapsed(now, startedAt) };
  } catch {
    return {
      failureCode: investigationSignal.aborted
        ? 'canceled'
        : controller.signal.reason instanceof ToolDeadlineError
          ? 'timeout'
          : 'provider_failure',
      durationMs: elapsed(now, startedAt),
    };
  } finally {
    clearTimeout(timer);
    investigationSignal.removeEventListener('abort', cancel);
  }
}

function canonicalJson(
  value: unknown,
  maximumBytes: number,
  oversizedCode: 'input_too_large' | 'invalid_output',
): z.infer<typeof jsonValueSchema> {
  const parsed = jsonValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new ToolInvocationError(
      oversizedCode === 'input_too_large' ? 'invalid_input' : 'input_too_large',
      'Tool value is not canonical JSON.',
    );
  }
  const encoded = JSON.stringify(parsed.data);
  if (Buffer.byteLength(encoded, 'utf8') > maximumBytes) {
    throw new ToolInvocationError(
      oversizedCode === 'input_too_large'
        ? 'input_too_large'
        : 'input_too_large',
      'Tool value exceeds its retained-size limit.',
    );
  }
  return parsed.data;
}

function estimatedUsage(
  tool: RegisteredTool,
  input: unknown,
  maxAttempts: number,
): BudgetDelta {
  return mergeUsage(
    scaleUsage(tool.perAttemptBudget ?? {}, maxAttempts),
    tool.estimateBudget(input),
    {
      wallClockMs:
        tool.timeoutMs * maxAttempts +
        tool.retryPolicy.delayMs * tool.retryPolicy.maxRetries,
    },
  );
}

function actualUsage(
  tool: RegisteredTool,
  input: unknown,
  output: unknown,
  attempts: number,
  wallClockMs: number,
): BudgetDelta {
  return mergeUsage(
    scaleUsage(tool.perAttemptBudget ?? {}, attempts),
    output === undefined ? {} : tool.measureBudget(input, output),
    { wallClockMs },
  );
}

function scaleUsage(delta: BudgetDelta, multiplier: number): BudgetDelta {
  return Object.fromEntries(
    Object.entries(delta)
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
      .map(([key, value]) => [key, value * multiplier]),
  );
}

function mergeUsage(...deltas: readonly BudgetDelta[]): BudgetDelta {
  const merged: Record<string, number> = {};
  for (const delta of deltas) {
    for (const [key, value] of Object.entries(delta)) {
      if (value === undefined) continue;
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new DelayCanceledError(signal.reason));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
