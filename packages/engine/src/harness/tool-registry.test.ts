/** Verifies validated, lifecycle-owned typed tool registration. */

import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { ToolRegistry, ToolRegistrationError } from './tool-registry.js';

describe('ToolRegistry', () => {
  it('registers typed tools and emits strict model-visible schemas', async () => {
    const registry = new ToolRegistry();
    const registration = registry.register({
      name: 'fixture.echo',
      description: 'Echoes one value.',
      inputSchema: z.object({ text: z.string() }).strict(),
      outputSchema: z.object({ text: z.string() }).strict(),
      timeoutMs: 100,
      retryPolicy: {
        maxRetries: 0,
        delayMs: 0,
        retryableFailureCodes: [],
      },
      execute: (input) => Promise.resolve(input),
    });

    expect(registry.get('fixture.echo').name).toBe('fixture.echo');
    expect(registry.modelTools()).toEqual([
      expect.objectContaining({
        name: 'fixture.echo',
        inputSchema: expect.objectContaining({
          type: 'object',
          additionalProperties: false,
        }),
      }),
    ]);
    await registration.dispose();
    expect(registry.list()).toEqual([]);
  });

  it('rejects duplicate names and malformed execution policy', () => {
    const registry = new ToolRegistry();
    const definition = {
      name: 'fixture.echo',
      description: 'Echoes one value.',
      inputSchema: z.object({ text: z.string() }).strict(),
      outputSchema: z.object({ text: z.string() }).strict(),
      timeoutMs: 100,
      retryPolicy: {
        maxRetries: 0,
        delayMs: 0,
        retryableFailureCodes: [] as const,
      },
      execute: (input: { text: string }) => Promise.resolve(input),
    };
    registry.register(definition);
    expect(() => registry.register(definition)).toThrowError(
      expect.objectContaining<Partial<ToolRegistrationError>>({
        code: 'duplicate_tool_name',
      }),
    );
    expect(() =>
      registry.register({ ...definition, name: 'UPPERCASE' }),
    ).toThrowError(
      expect.objectContaining<Partial<ToolRegistrationError>>({
        code: 'invalid_tool_definition',
      }),
    );
    expect(() =>
      registry.register({
        ...definition,
        name: 'fixture.invalid_timeout',
        timeoutMs: 0,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ToolRegistrationError>>({
        code: 'invalid_tool_definition',
      }),
    );
  });
});
