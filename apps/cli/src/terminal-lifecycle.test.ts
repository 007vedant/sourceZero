/** Verifies terminal teardown after success, renderer failure, and interruption. */

import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { RenderOptions } from 'ink';

import {
  runInteractiveTerminal,
  type InteractiveTerminalInstance,
  type TerminalSignalHost,
} from './terminal-lifecycle.js';

describe('interactive terminal lifecycle', () => {
  it('uses the alternate screen and tears down after normal exit', async () => {
    const harness = lifecycleHarness(Promise.resolve());

    await runInteractiveTerminal(harness.options);

    expect(harness.renderOptions).toMatchObject({
      alternateScreen: true,
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    expect(harness.unmountCount()).toBe(1);
    expect(harness.listenerCount()).toBe(0);
  });

  it('tears down when the renderer lifecycle fails', async () => {
    const failure = new Error('renderer failed');
    const harness = lifecycleHarness(Promise.reject(failure));

    await expect(runInteractiveTerminal(harness.options)).rejects.toBe(failure);
    expect(harness.unmountCount()).toBe(1);
    expect(harness.listenerCount()).toBe(0);
  });

  it('restores signal listeners when terminal boot fails', async () => {
    const failure = new Error('terminal boot failed');
    const harness = lifecycleHarness(Promise.resolve());

    await expect(
      runInteractiveTerminal({
        ...harness.options,
        renderer: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(harness.unmountCount()).toBe(0);
    expect(harness.listenerCount()).toBe(0);
  });

  it('unmounts and restores signal listeners when interrupted', async () => {
    let settle: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const harness = lifecycleHarness(waiting, () => settle?.());
    const running = runInteractiveTerminal(harness.options);

    harness.emit('SIGINT');
    await running;

    expect(harness.unmountCount()).toBe(1);
    expect(harness.listenerCount()).toBe(0);
  });
});

function lifecycleHarness(
  waiting: Promise<unknown>,
  onUnmount: () => void = () => undefined,
) {
  const listeners = new Map<string, Set<() => void>>();
  let unmounts = 0;
  let capturedOptions: RenderOptions | undefined;
  const signals: TerminalSignalHost = {
    on(signal, listener) {
      const registered = listeners.get(signal) ?? new Set();
      registered.add(listener);
      listeners.set(signal, registered);
    },
    off(signal, listener) {
      listeners.get(signal)?.delete(listener);
    },
  };
  const instance: InteractiveTerminalInstance = {
    unmount() {
      if (unmounts === 0) {
        unmounts += 1;
        onUnmount();
      }
    },
    waitUntilExit: () => waiting,
  };
  return {
    options: {
      streams: {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
      },
      screenReader: false,
      reducedDecoration: false,
      signals,
      renderer: (_node: ReactNode, options: RenderOptions) => {
        capturedOptions = options;
        return instance;
      },
    },
    get renderOptions() {
      return capturedOptions;
    },
    unmountCount: () => unmounts,
    listenerCount: () =>
      [...listeners.values()].reduce((total, set) => total + set.size, 0),
    emit(signal: 'SIGINT' | 'SIGTERM') {
      for (const listener of listeners.get(signal) ?? []) {
        listener();
      }
    },
  };
}
