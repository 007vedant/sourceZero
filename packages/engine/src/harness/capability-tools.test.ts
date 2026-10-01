/** Verifies provider seams are invoked only through registered central tools. */

import { describe, expect, it, vi } from 'vitest';

import { createInvestigationId } from '../domain/identifiers.js';
import { SqliteStore } from '../persistence/sqlite-store.js';
import { investigationCreatedDraft } from '../persistence/test-fixtures.js';
import { InMemoryBudgetAccountant } from './budget.js';
import { createModelProviderTool } from './capability-tools.js';
import { DurableHarnessEventRecorder } from './event-recorder.js';
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from './provider-contracts.js';
import { ProviderRegistry } from './provider-registry.js';
import { ToolExecutor } from './tool-executor.js';
import { ToolRegistry } from './tool-registry.js';

const request: ModelRequest = {
  operationId: 'operation-1',
  modelId: 'fixture-model',
  maxOutputTokens: 100,
  messages: [{ role: 'user', content: 'Choose the next action.' }],
  tools: [],
};
const response: ModelResponse = {
  outcome: 'completed',
  providerRequestId: 'response-1',
  modelId: 'fixture-model',
  text: 'Stop.',
  toolCalls: [],
  usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
};

describe('provider capability tools', () => {
  it('routes a selected model provider through durable execution', async () => {
    const complete = vi.fn(() => Promise.resolve(response));
    const providers = new ProviderRegistry<ModelProvider>('model');
    providers.register({ id: 'fixture', complete });
    const tools = new ToolRegistry();
    tools.register(
      createModelProviderTool(providers, {
        providerId: 'fixture',
        timeoutMs: 100,
        retryPolicy: {
          maxRetries: 0,
          delayMs: 0,
          retryableFailureCodes: [],
        },
      }),
    );
    expect(tools.modelTools()[0]).toMatchObject({
      name: 'provider.model.complete',
      inputSchema: { type: 'object', additionalProperties: false },
    });
    const store = await SqliteStore.open({ databasePath: ':memory:' });
    const investigationId = createInvestigationId();
    store.createInvestigation(investigationId, investigationCreatedDraft());
    const budget = new InMemoryBudgetAccountant({
      modelTokens: 10_000,
      wallClockMs: 10_000,
    });
    const executor = new ToolExecutor({
      registry: tools,
      recorder: new DurableHarnessEventRecorder({ repository: store }),
      budget,
    });

    await expect(
      executor.execute({
        investigationId,
        toolName: 'provider.model.complete',
        input: request,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      outcome: 'succeeded',
      output: response,
      usage: { modelTokens: 8 },
    });
    expect(complete).toHaveBeenCalledWith(request, expect.any(AbortSignal));
    expect(
      store
        .readInvestigationSnapshot(investigationId, 0)
        .events.map((event) => event.type),
    ).toEqual([
      'investigation.created',
      'tool.requested',
      'tool.started',
      'tool.succeeded',
      'budget.consumed',
    ]);
    store.dispose();
  });

  it('turns ambiguous selection and invalid provider values into failures', async () => {
    const providers = new ProviderRegistry<ModelProvider>('model');
    providers.register({
      id: 'first',
      complete: () => Promise.resolve(response),
    });
    providers.register({
      id: 'second',
      complete: () => Promise.resolve(response),
    });
    const tools = new ToolRegistry();
    tools.register(
      createModelProviderTool(providers, {
        timeoutMs: 100,
        retryPolicy: {
          maxRetries: 0,
          delayMs: 0,
          retryableFailureCodes: [],
        },
      }),
    );
    const store = await SqliteStore.open({ databasePath: ':memory:' });
    const investigationId = createInvestigationId();
    store.createInvestigation(investigationId, investigationCreatedDraft());
    const executor = new ToolExecutor({
      registry: tools,
      recorder: new DurableHarnessEventRecorder({ repository: store }),
      budget: new InMemoryBudgetAccountant({
        modelTokens: 10_000,
        wallClockMs: 10_000,
      }),
    });

    await expect(
      executor.execute({
        investigationId,
        toolName: 'provider.model.complete',
        input: request,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      outcome: 'failed',
      failureCode: 'provider_failure',
    });
    expect(
      store
        .readInvestigationSnapshot(investigationId, 0)
        .events.some((event) => event.type === 'tool.succeeded'),
    ).toBe(false);
    store.dispose();
  });
});
