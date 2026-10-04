import {
  createServiceKey,
  loadLocalConfiguration,
  PluginRuntime,
  type Plugin,
} from '@sourcezero/engine/runtime';
import {
  investigationIdSchema,
  type OriginalInput,
  type SourceZeroConfig,
} from '@sourcezero/engine';
import type { InvestigationWorkspaceView } from '@sourcezero/presentation';
import { Command } from 'commander';

import { renderJsonWorkspace, renderPlainWorkspace } from './output.js';
import { runInteractiveTerminal } from './terminal-lifecycle.js';
import type { TerminalFramingActions } from './terminal-app.js';
import { createFixtureWorkspace } from './terminal-fixtures.js';
import {
  openLocalFramingRuntime,
  type LocalFramingRuntime,
} from './framing-runtime.js';

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
  readonly interactiveWorkspace?: (options: {
    readonly screenReader: boolean;
    readonly reducedDecoration: boolean;
    readonly initialWorkspace: InvestigationWorkspaceView;
    readonly framingActions: TerminalFramingActions;
  }) => Promise<void>;
}

interface CliOptions {
  readonly config?: string;
  readonly plain?: boolean;
  readonly json?: boolean;
  readonly screenReader?: boolean;
  readonly reducedDecoration?: boolean;
  readonly dataDir?: string;
}

interface InvestigateOptions {
  readonly url?: string;
  readonly confirm?: boolean;
}

export interface CliDependencies {
  readonly openFramingRuntime?: (
    config: SourceZeroConfig,
    dataDirectory?: string,
  ) => Promise<LocalFramingRuntime>;
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
    interactiveWorkspace: async (options) =>
      runInteractiveTerminal({
        ...options,
        streams: {
          stdin: process.stdin,
          stdout: process.stdout,
          stderr: process.stderr,
        },
      }),
  },
  dependencies: CliDependencies = {},
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
    .option(
      '--data-dir <path>',
      'directory for the durable local database and artifacts',
    )
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: io.stdout,
      writeErr: io.stderr,
    });

  program.action(async (options: CliOptions) => {
    assertOutputMode(options);
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

  program
    .command('investigate')
    .description('frame one claim and create a durable bounded investigation')
    .argument('[claim]', 'claim to frame')
    .option('--url <url>', 'public HTTP/HTTPS page to frame')
    .option(
      '--confirm',
      'explicitly confirm the first proposal and start the run',
    )
    .action(async (claim: string | undefined, options: InvestigateOptions) => {
      const globalOptions = program.opts<CliOptions>();
      assertOutputMode(globalOptions);
      const originalInput = investigationInput(claim, options.url);
      const config = await loadLocalConfiguration(
        globalOptions.config === undefined
          ? {}
          : { path: globalOptions.config },
      );
      const openRuntime =
        dependencies.openFramingRuntime ?? openLocalFramingRuntime;
      const runtime = await openRuntime(config, globalOptions.dataDir);
      try {
        let workspace = await runtime.framing.begin({
          originalInput,
          policy: runtime.policy,
          modelId: runtime.modelId,
          signal: new AbortController().signal,
        });
        if (options.confirm === true) {
          const working = workspace.framing.workingClaim;
          if (working === undefined) {
            throw new Error(
              'The framing result has no claim available for confirmation.',
            );
          }
          workspace = runtime.investigations.confirmClaim(
            workspace.investigationId,
            working,
          );
        }
        if (
          globalOptions.plain !== true &&
          globalOptions.json !== true &&
          io.isTTY === true
        ) {
          const interactive =
            io.interactiveWorkspace ??
            (() =>
              Promise.reject(
                new Error('Interactive terminal streams are unavailable.'),
              ));
          await interactive({
            screenReader: globalOptions.screenReader === true,
            reducedDecoration: globalOptions.reducedDecoration === true,
            initialWorkspace: workspace,
            framingActions: {
              edit: (current, wording) =>
                runtime.investigations.editClaim(
                  investigationIdSchema.parse(current.investigationId),
                  {
                    wording,
                  },
                ),
              confirm: (current, claimId, wording) =>
                runtime.investigations.confirmClaim(
                  investigationIdSchema.parse(current.investigationId),
                  { claimId, wording },
                ),
            },
          });
        } else {
          renderWorkspace(workspace, globalOptions, io);
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

function assertOutputMode(options: CliOptions): void {
  if (options.plain === true && options.json === true) {
    throw new Error('--plain and --json cannot be used together.');
  }
}

function investigationInput(
  claim: string | undefined,
  url: string | undefined,
): OriginalInput {
  if (claim !== undefined && claim.trim().length > 0 && url !== undefined) {
    throw new Error('Provide either a claim or --url, not both.');
  }
  if (url !== undefined) return { kind: 'url', url };
  if (claim !== undefined && claim.trim().length > 0) {
    return { kind: 'claim', claim };
  }
  throw new Error(
    'The investigate command requires a non-empty claim or --url.',
  );
}

function renderWorkspace(
  workspace: InvestigationWorkspaceView,
  options: CliOptions,
  io: CliIo,
): void {
  if (options.json === true) {
    io.stdout(renderJsonWorkspace(workspace));
  } else {
    io.stdout(renderPlainWorkspace(workspace));
  }
}
