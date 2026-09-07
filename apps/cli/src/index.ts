import {
  createServiceKey,
  loadLocalConfiguration,
  PluginRuntime,
  type Plugin,
} from '@sourcezero/engine/runtime';
import { Command } from 'commander';

import { renderJsonWorkspace, renderPlainWorkspace } from './output.js';
import { runInteractiveTerminal } from './terminal-lifecycle.js';
import { createFixtureWorkspace } from './terminal-fixtures.js';

const bootStatusService = createServiceKey<{ readonly status: 'ready' }>(
  'sourcezero.cli.boot-status',
);

const fixturePlugin: Plugin = {
  id: 'sourcezero.cli.fixture',
  provides: [bootStatusService],
  setup(context) {
    context.registerService(bootStatusService, { status: 'ready' });
  },
};

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly isTTY?: boolean;
  readonly interactive?: (options: {
    readonly screenReader: boolean;
    readonly reducedDecoration: boolean;
  }) => Promise<void>;
}

interface CliOptions {
  readonly config?: string;
  readonly plain?: boolean;
  readonly json?: boolean;
  readonly screenReader?: boolean;
  readonly reducedDecoration?: boolean;
}

export async function runCli(
  args: readonly string[],
  io: CliIo = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    isTTY: process.stdout.isTTY,
    interactive: async (options) =>
      runInteractiveTerminal({
        ...options,
        streams: {
          stdin: process.stdin,
          stdout: process.stdout,
          stderr: process.stderr,
        },
      }),
  },
): Promise<number> {
  const program = new Command()
    .name('sourcezero')
    .description('Trace every claim back to zero.')
    .version('0.0.0')
    .option('--config <path>', 'path to a local JSON configuration file')
    .option('--plain', 'emit append-only human-readable output')
    .option('--json', 'emit machine-readable JSON output')
    .option('--screen-reader', 'enable linear screen-reader output')
    .option('--reduced-decoration', 'avoid nonessential terminal decoration')
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: io.stdout,
      writeErr: io.stderr,
    });

  program.action(async (options: CliOptions) => {
    if (options.plain === true && options.json === true) {
      throw new Error('--plain and --json cannot be used together.');
    }
    await loadLocalConfiguration(
      options.config === undefined ? {} : { path: options.config },
    );
    const runtime = await PluginRuntime.boot([fixturePlugin]);
    try {
      runtime.getService(bootStatusService);
      const workspace = createFixtureWorkspace();
      if (options.json === true) {
        io.stdout(renderJsonWorkspace(workspace));
      } else if (options.plain === true || io.isTTY !== true) {
        io.stdout(renderPlainWorkspace(workspace));
      } else {
        const interactive =
          io.interactive ??
          (() =>
            Promise.reject(
              new Error('Interactive terminal streams are unavailable.'),
            ));
        await interactive({
          screenReader: options.screenReader === true,
          reducedDecoration: options.reducedDecoration === true,
        });
      }
    } finally {
      await runtime.dispose();
    }
  });

  try {
    await program.parseAsync([...args], { from: 'user' });
    return 0;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'CommanderError') {
      return 'exitCode' in error && typeof error.exitCode === 'number'
        ? error.exitCode
        : 1;
    }
    io.stderr(
      `${error instanceof Error ? error.message : 'Unknown CLI failure.'}\n`,
    );
    return 1;
  }
}
