/**
 * Owns typed tool registrations while exposing an erased executor-safe boundary.
 */

import { z } from 'zod';

import {
  toolFailureCodeSchema,
  type BudgetDelta,
  type ToolFailureCode,
} from '../domain/events.js';
import type { ToolCallId } from '../domain/identifiers.js';
import type { Disposable } from '../runtime/disposable.js';
import { toDisposable } from '../runtime/disposable.js';
import { modelToolSchema, type ModelRequest } from './provider-contracts.js';

export interface ToolExecutionContext {
  readonly signal: AbortSignal;
  readonly toolCallId: ToolCallId;
  readonly attempt: number;
}

export interface ToolRetryPolicy {
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly retryableFailureCodes: readonly ToolFailureCode[];
}

export interface ToolBudgetPolicy<Input, Output> {
  readonly perAttempt?: BudgetDelta;
  estimate?(input: Input): BudgetDelta;
  measure?(input: Input, output: Output): BudgetDelta;
}

export interface ToolDefinition<Input, Output> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<Input>;
  readonly outputSchema: z.ZodType<Output>;
  readonly timeoutMs: number;
  readonly retryPolicy: ToolRetryPolicy;
  readonly budget?: ToolBudgetPolicy<Input, Output>;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  execute(input: Input, context: ToolExecutionContext): Promise<Output>;
}

export interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  readonly timeoutMs: number;
  readonly retryPolicy: ToolRetryPolicy;
  readonly perAttemptBudget: BudgetDelta | undefined;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  estimateBudget(input: unknown): BudgetDelta;
  measureBudget(input: unknown, output: unknown): BudgetDelta;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

export type ToolRegistrationErrorCode =
  'duplicate_tool_name' | 'invalid_tool_definition' | 'tool_not_registered';

/** Reports deterministic tool definition and lookup failures. */
export class ToolRegistrationError extends Error {
  public constructor(
    public readonly code: ToolRegistrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ToolRegistrationError';
  }
}

/** Registers tools with lifecycle-owned removal and validated definitions. */
export class ToolRegistry implements Disposable {
  readonly #tools = new Map<string, RegisteredTool>();
  #disposed = false;

  public register<Input, Output>(
    definition: ToolDefinition<Input, Output>,
  ): Disposable {
    this.#assertActive();
    validateDefinition(definition);
    if (this.#tools.has(definition.name)) {
      throw new ToolRegistrationError(
        'duplicate_tool_name',
        `Tool "${definition.name}" is already registered.`,
      );
    }
    const erased = eraseDefinition(definition);
    this.#tools.set(definition.name, erased);
    return toDisposable(() => {
      if (this.#tools.get(definition.name) === erased) {
        this.#tools.delete(definition.name);
      }
    });
  }

  public get(name: string): RegisteredTool {
    this.#assertActive();
    const tool = this.#tools.get(name);
    if (tool === undefined) {
      throw new ToolRegistrationError(
        'tool_not_registered',
        `Tool "${name}" is not registered.`,
      );
    }
    return tool;
  }

  public list(): readonly RegisteredTool[] {
    this.#assertActive();
    return [...this.#tools.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  public modelTools(): ModelRequest['tools'] {
    return this.list().map((tool) =>
      modelToolSchema.parse({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.inputSchema),
      }),
    );
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#tools.clear();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Tool registry is disposed.');
  }
}

function validateDefinition<Input, Output>(
  definition: ToolDefinition<Input, Output>,
): void {
  if (!/^[a-z][a-z0-9_.-]{0,199}$/u.test(definition.name)) {
    throw new ToolRegistrationError(
      'invalid_tool_definition',
      'Tool name must be a lowercase canonical identifier.',
    );
  }
  if (definition.description.trim().length === 0) {
    throw new ToolRegistrationError(
      'invalid_tool_definition',
      `Tool "${definition.name}" requires a description.`,
    );
  }
  if (definition.description.length > 2_000) {
    throw new ToolRegistrationError(
      'invalid_tool_definition',
      `Tool "${definition.name}" description exceeds 2,000 characters.`,
    );
  }
  if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs <= 0) {
    throw new ToolRegistrationError(
      'invalid_tool_definition',
      `Tool "${definition.name}" requires a positive integer timeout.`,
    );
  }
  if (
    !Number.isInteger(definition.retryPolicy.maxRetries) ||
    definition.retryPolicy.maxRetries < 0 ||
    !Number.isInteger(definition.retryPolicy.delayMs) ||
    definition.retryPolicy.delayMs < 0
  ) {
    throw new ToolRegistrationError(
      'invalid_tool_definition',
      `Tool "${definition.name}" has an invalid retry policy.`,
    );
  }
  if (
    !toolFailureCodeSchema
      .array()
      .safeParse(definition.retryPolicy.retryableFailureCodes).success ||
    new Set(definition.retryPolicy.retryableFailureCodes).size !==
      definition.retryPolicy.retryableFailureCodes.length
  ) {
    throw new ToolRegistrationError(
      'invalid_tool_definition',
      `Tool "${definition.name}" has invalid retryable failure codes.`,
    );
  }
  for (const [label, value] of [
    ['input', definition.maxInputBytes],
    ['output', definition.maxOutputBytes],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new ToolRegistrationError(
        'invalid_tool_definition',
        `Tool "${definition.name}" requires a positive ${label} byte limit.`,
      );
    }
  }
}

function eraseDefinition<Input, Output>(
  definition: ToolDefinition<Input, Output>,
): RegisteredTool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    timeoutMs: definition.timeoutMs,
    retryPolicy: definition.retryPolicy,
    perAttemptBudget: definition.budget?.perAttempt,
    maxInputBytes: definition.maxInputBytes ?? 64 * 1024,
    maxOutputBytes: definition.maxOutputBytes ?? 256 * 1024,
    estimateBudget: (input) =>
      definition.budget?.estimate?.(input as Input) ?? {},
    measureBudget: (input, output) =>
      definition.budget?.measure?.(input as Input, output as Output) ?? {},
    execute: (input, context) => definition.execute(input as Input, context),
  };
}
