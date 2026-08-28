import { describe, expect, it, vi } from 'vitest';

import { toDisposable } from './disposable.js';
import { RuntimeError } from './errors.js';
import { PluginRuntime, type Plugin } from './plugin-runtime.js';
import { createServiceKey } from './service-key.js';

const alphaService = createServiceKey<string>('test.alpha');
const betaService = createServiceKey<number>('test.beta');

describe('PluginRuntime', () => {
  it('starts dependencies first in deterministic order and exposes services', async () => {
    const started: string[] = [];
    const plugins: Plugin[] = [
      {
        id: 'consumer',
        requires: [alphaService],
        provides: [betaService],
        setup(context) {
          started.push(`consumer:${context.getService(alphaService)}`);
          context.registerService(betaService, 42);
        },
      },
      {
        id: 'provider',
        provides: [alphaService],
        setup(context) {
          started.push('provider');
          context.registerService(alphaService, 'ready');
        },
      },
      {
        id: 'aardvark',
        setup() {
          started.push('aardvark');
        },
      },
    ];

    const runtime = await PluginRuntime.boot(plugins);

    expect(started).toEqual(['aardvark', 'provider', 'consumer:ready']);
    expect(runtime.getService(betaService)).toBe(42);
    await runtime.dispose();
  });

  it.each([
    {
      name: 'duplicate plugin IDs',
      code: 'duplicate_plugin_id',
      plugins: [
        { id: 'same', setup() {} },
        { id: 'same', setup() {} },
      ],
    },
    {
      name: 'duplicate service ownership',
      code: 'duplicate_service_owner',
      plugins: [
        { id: 'one', provides: [alphaService], setup() {} },
        { id: 'two', provides: [alphaService], setup() {} },
      ],
    },
    {
      name: 'missing dependencies',
      code: 'missing_dependency',
      plugins: [{ id: 'consumer', requires: [alphaService], setup() {} }],
    },
    {
      name: 'dependency cycles',
      code: 'dependency_cycle',
      plugins: [
        {
          id: 'one',
          requires: [betaService],
          provides: [alphaService],
          setup() {},
        },
        {
          id: 'two',
          requires: [alphaService],
          provides: [betaService],
          setup() {},
        },
      ],
    },
  ] satisfies readonly {
    readonly name: string;
    readonly code: RuntimeError['code'];
    readonly plugins: readonly Plugin[];
  }[])('rejects $name with an actionable error', async ({ code, plugins }) => {
    await expect(PluginRuntime.boot(plugins)).rejects.toMatchObject({ code });
  });

  it('rejects a registration the plugin did not declare', async () => {
    await expect(
      PluginRuntime.boot([
        {
          id: 'undeclared',
          setup(context) {
            context.registerService(alphaService, 'hidden');
          },
        },
      ]),
    ).rejects.toMatchObject({ code: 'undeclared_service_registration' });
  });

  it('rejects a declared service that setup does not register', async () => {
    const dispose = vi.fn();
    await expect(
      PluginRuntime.boot([
        {
          id: 'incomplete',
          provides: [alphaService],
          setup: () => toDisposable(dispose),
        },
      ]),
    ).rejects.toMatchObject({ code: 'service_not_registered' });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('wraps an unexpected setup failure with the plugin identity', async () => {
    await expect(
      PluginRuntime.boot([
        {
          id: 'broken',
          setup() {
            throw new Error('internal detail');
          },
        },
      ]),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'plugin_setup_failed',
        message: expect.stringContaining('broken'),
      }),
    );
  });

  it('rolls back partially started plugins in reverse order', async () => {
    const lifecycle: string[] = [];
    const plugin = (id: string): Plugin => ({
      id,
      setup() {
        lifecycle.push(`start:${id}`);
        return toDisposable(() => {
          lifecycle.push(`dispose:${id}`);
        });
      },
    });

    await expect(
      PluginRuntime.boot([
        plugin('a'),
        plugin('b'),
        {
          id: 'c',
          setup() {
            lifecycle.push('start:c');
            throw new Error('stop');
          },
        },
      ]),
    ).rejects.toBeInstanceOf(RuntimeError);
    expect(lifecycle).toEqual([
      'start:a',
      'start:b',
      'start:c',
      'dispose:b',
      'dispose:a',
    ]);
  });

  it('disposes a successful composition in reverse order exactly once', async () => {
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    const runtime = await PluginRuntime.boot([
      { id: 'a', setup: () => toDisposable(disposeA) },
      { id: 'b', setup: () => toDisposable(disposeB) },
    ]);

    await runtime.dispose();
    await runtime.dispose();

    expect(disposeB).toHaveBeenCalledOnce();
    expect(disposeA).toHaveBeenCalledOnce();
    expect(disposeB.mock.invocationCallOrder[0]).toBeLessThan(
      disposeA.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(() => runtime.getService(alphaService)).toThrowError(
      expect.objectContaining({ code: 'runtime_disposed' }),
    );
  });
});
