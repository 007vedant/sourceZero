import {
  createServiceKey,
  loadLocalConfiguration,
  PluginRuntime,
  type Plugin,
} from '@sourcezero/engine';
import { Command } from 'commander';

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
}

interface CliOptions {
  readonly config?: string;
}

export async function runCli(
  args: readonly string[],
  io: CliIo = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
): Promise<number> {
  const program = new Command()
    .name('sourcezero')
    .description('Trace every claim back to zero.')
    .version('0.0.0')
    .option('--config <path>', 'path to a local JSON configuration file')
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: io.stdout,
      writeErr: io.stderr,
    });

  program.action(async (options: CliOptions) => {
    await loadLocalConfiguration(
      options.config === undefined ? {} : { path: options.config },
    );
    const runtime = await PluginRuntime.boot([fixturePlugin]);
    try {
      runtime.getService(bootStatusService);
      io.stdout('SourceZero runtime ready.\n');
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
