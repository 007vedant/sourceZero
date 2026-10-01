/** Verifies provider boundary validation and deterministic provider selection. */

import { describe, expect, it, vi } from 'vitest';

import {
  fetchRequestSchema,
  modelRequestSchema,
  modelResponseSchema,
  searchResponseSchema,
  type ModelProvider,
} from './provider-contracts.js';
import {
  ProviderRegistry,
  ProviderResolutionError,
} from './provider-registry.js';

describe('provider contracts', () => {
  it('accepts normalized model requests and responses', () => {
    expect(
      modelRequestSchema.parse({
        operationId: 'operation-1',
        modelId: 'fixture-model',
        maxOutputTokens: 1_000,
        messages: [{ role: 'user', content: 'Investigate this claim.' }],
      }),
    ).toMatchObject({ tools: [] });
    expect(
      modelResponseSchema.parse({
        outcome: 'completed',
        providerRequestId: 'response-1',
        modelId: 'fixture-model',
        text: '',
        toolCalls: [],
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      }),
    ).toBeDefined();
  });

  it('rejects non-public protocols and malformed provider values', () => {
    expect(() =>
      fetchRequestSchema.parse({
        operationId: 'operation-1',
        url: 'file:///etc/passwd',
      }),
    ).toThrow();
    expect(() =>
      searchResponseSchema.parse({
        results: [{ url: 'https://example.com', title: '', unknown: true }],
      }),
    ).toThrow();
    expect(() =>
      modelResponseSchema.parse({
        outcome: 'completed',
        providerRequestId: 'response-1',
        modelId: 'fixture-model',
        text: '',
        toolCalls: [],
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 6 },
      }),
    ).toThrow();
  });
});

describe('ProviderRegistry', () => {
  const provider = (id: string): ModelProvider => ({
    id,
    complete: vi.fn(),
  });

  it('selects one provider automatically or an explicit provider', () => {
    const registry = new ProviderRegistry<ModelProvider>('model');
    const first = provider('first');
    const second = provider('second');
    registry.register(first);
    expect(registry.resolve()).toBe(first);
    registry.register(second);
    expect(registry.resolve('second')).toBe(second);
    expect(registry.listIds()).toEqual(['first', 'second']);
  });

  it('fails clearly for duplicate, missing, and ambiguous selection', () => {
    const registry = new ProviderRegistry<ModelProvider>('model');
    expect(() => registry.resolve()).toThrowError(
      expect.objectContaining<Partial<ProviderResolutionError>>({
        code: 'provider_unavailable',
      }),
    );
    registry.register(provider('first'));
    expect(() => registry.register(provider('first'))).toThrowError(
      expect.objectContaining<Partial<ProviderResolutionError>>({
        code: 'duplicate_provider_id',
      }),
    );
    registry.register(provider('second'));
    expect(() => registry.resolve()).toThrowError(
      expect.objectContaining<Partial<ProviderResolutionError>>({
        code: 'ambiguous_provider_selection',
      }),
    );
    expect(() => registry.resolve('missing')).toThrowError(
      expect.objectContaining<Partial<ProviderResolutionError>>({
        code: 'provider_unavailable',
      }),
    );
  });

  it('removes registrations through their lifecycle disposer', async () => {
    const registry = new ProviderRegistry<ModelProvider>('model');
    const registration = registry.register(provider('fixture'));
    await registration.dispose();
    expect(registry.listIds()).toEqual([]);
  });
});
