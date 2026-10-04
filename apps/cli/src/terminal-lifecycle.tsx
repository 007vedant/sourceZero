/**
 * Owns Ink startup and guarantees teardown after exit, renderer failure, or process signals.
 */

import { render, type Instance, type RenderOptions } from 'ink';
import type { ReactNode } from 'react';

import { TerminalApp, type TerminalAppProperties } from './terminal-app.js';

type TerminalSignal = 'SIGINT' | 'SIGTERM';
type SignalListener = () => void;

export interface TerminalSignalHost {
  on(signal: TerminalSignal, listener: SignalListener): void;
  off(signal: TerminalSignal, listener: SignalListener): void;
}

export interface InteractiveTerminalStreams {
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
}

export interface InteractiveTerminalInstance {
  unmount(error?: Error | number | null): void;
  waitUntilExit(): Promise<unknown>;
}

export type InteractiveTerminalRenderer = (
  node: ReactNode,
  options: RenderOptions,
) => InteractiveTerminalInstance;

export interface InteractiveTerminalOptions extends TerminalAppProperties {
  readonly streams: InteractiveTerminalStreams;
  readonly renderer?: InteractiveTerminalRenderer;
  readonly signals?: TerminalSignalHost;
}

export async function runInteractiveTerminal(
  options: InteractiveTerminalOptions,
): Promise<void> {
  const renderer = options.renderer ?? defaultRenderer;
  const signals = options.signals ?? process;
  let instance: InteractiveTerminalInstance | undefined;
  const terminate = (): void => {
    instance?.unmount();
  };

  signals.on('SIGINT', terminate);
  signals.on('SIGTERM', terminate);
  try {
    instance = renderer(
      <TerminalApp
        screenReader={options.screenReader}
        reducedDecoration={options.reducedDecoration}
        initialState={options.initialState}
        fixtureStatus={options.fixtureStatus}
        initialWorkspace={options.initialWorkspace}
        framingActions={options.framingActions}
      />,
      {
        stdin: options.streams.stdin,
        stdout: options.streams.stdout,
        stderr: options.streams.stderr,
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: true,
        alternateScreen: true,
        isScreenReaderEnabled: options.screenReader,
      },
    );
    await instance.waitUntilExit();
  } finally {
    signals.off('SIGINT', terminate);
    signals.off('SIGTERM', terminate);
    instance?.unmount();
  }
}

function defaultRenderer(node: ReactNode, options: RenderOptions): Instance {
  return render(node, options);
}
