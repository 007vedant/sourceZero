/** Verifies projection ownership, duplicate rejection, and plugin lifecycle cleanup. */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ProjectionDefinition } from '../domain/projection.js';
import { PluginRuntime } from './plugin-runtime.js';
import { ProjectionRegistry } from './projection-registry.js';

const fixtureProjection: ProjectionDefinition<number, number> = {
  id: 'test.fixture',
  version: 1,
  stateSchema: z.number(),
  init: () => 0,
  apply: (state) => state,
  view: (state) => state,
};

describe('ProjectionRegistry', () => {
  it('registers deterministically and removes a disposed registration', async () => {
    const registry = new ProjectionRegistry();
    const registration = registry.register('owner', fixtureProjection);

    expect(registry.list()).toEqual([{ id: 'test.fixture', version: 1 }]);
    registry.assertRegistered(fixtureProjection);
    await registration.dispose();
    expect(registry.list()).toEqual([]);
    registry.dispose();
  });

  it('rejects duplicate projection ownership', () => {
    const registry = new ProjectionRegistry();
    registry.register('first', fixtureProjection);

    expect(() => registry.register('second', fixtureProjection)).toThrowError(
      expect.objectContaining({ code: 'duplicate_projection_id' }),
    );
    registry.dispose();
  });

  it('binds projection registrations to plugin disposal', async () => {
    const runtime = await PluginRuntime.boot([
      {
        id: 'projection-plugin',
        setup(context) {
          context.registerProjection(fixtureProjection);
        },
      },
    ]);
    const registry = runtime.getProjectionRegistry();
    expect(registry.list()).toHaveLength(1);

    await runtime.dispose();

    expect(() => registry.list()).toThrowError(
      expect.objectContaining({ code: 'runtime_disposed' }),
    );
  });
});
