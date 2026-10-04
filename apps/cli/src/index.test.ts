/** Verifies terminal mode selection and ANSI-safe CLI output contracts. */

import { describe, expect, it } from 'vitest';

import { runCli, type CliIo } from './index.js';
import type { LocalFramingRuntime } from './framing-runtime.js';
import { createFixtureWorkspace } from './terminal-fixtures.js';

const escapeCharacter = String.fromCodePoint(27);

describe('sourcezero CLI', () => {
  it('defaults redirected output to plain mode without terminal controls', async () => {
    const result = await captureCli([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Investigation: inv_fixture_terminal');
    expect(result.stdout).toContain('Status: running');
    expect(result.stdout).not.toContain(escapeCharacter);
    expect(result.stderr).toBe('');
  });

  it('emits only parseable JSON in JSON mode', async () => {
    const result = await captureCli(['--json']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      investigationId: 'inv_fixture_terminal',
      overview: { status: 'running' },
    });
    expect(result.stdout).not.toContain(escapeCharacter);
    expect(result.stderr).toBe('');
  });

  it('selects the interactive lifecycle for a TTY and forwards accessibility flags', async () => {
    let interactiveOptions:
      | { readonly screenReader: boolean; readonly reducedDecoration: boolean }
      | undefined;
    const result = await captureCli(
      ['--screen-reader', '--reduced-decoration'],
      {
        isTTY: true,
        interactive: (options) => {
          interactiveOptions = options;
          return Promise.resolve();
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(interactiveOptions).toEqual({
      screenReader: true,
      reducedDecoration: true,
    });
    expect(result.stdout).toBe('');
  });

  it('rejects conflicting non-interactive modes without leaking output', async () => {
    const result = await captureCli(['--plain', '--json']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('--plain and --json cannot be used together.\n');
  });

  it('frames a claim durably and leaves non-interactive output awaiting explicit confirmation', async () => {
    const result = await captureCli(
      ['--plain', 'investigate', 'A rough claim.'],
      {},
      fixtureDependencies(),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Claim: A normalized claim.');
    expect(result.stdout).toContain('Status: awaiting_confirmation');
    expect(result.stdout).toContain('Confirmation required:');
    expect(result.stderr).toBe('');
  });

  it('starts the bounded run only with the explicit confirmation flag', async () => {
    const result = await captureCli(
      ['--json', 'investigate', '--confirm', 'A rough claim.'],
      {},
      fixtureDependencies(),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      overview: { status: 'running' },
      framing: { confirmedClaim: { wording: 'A normalized claim.' } },
    });
    expect(result.stderr).toBe('');
  });

  it('hands durable framing feedback and legal actions to the interactive TUI', async () => {
    let interactive:
      Parameters<NonNullable<CliIo['interactiveWorkspace']>>[0] | undefined;
    const result = await captureCli(
      ['investigate', 'A rough claim.'],
      {
        isTTY: true,
        interactiveWorkspace: (options) => {
          interactive = options;
          return Promise.resolve();
        },
      },
      fixtureDependencies(),
    );

    expect(result.exitCode).toBe(0);
    expect(interactive?.initialWorkspace).toMatchObject({
      overview: { status: 'awaiting_confirmation' },
      framing: { workingClaim: { wording: 'A normalized claim.' } },
    });
    expect(interactive?.framingActions).toBeDefined();
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('rejects ambiguous claim and URL input before opening providers', async () => {
    const result = await captureCli(
      ['investigate', 'A claim.', '--url', 'https://example.test'],
      {},
      fixtureDependencies(),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Provide either a claim or --url, not both.\n');
  });
});

async function captureCli(
  args: readonly string[],
  overrides: Partial<CliIo> = {},
  dependencies: Parameters<typeof runCli>[2] = {},
): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli(
    args,
    {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      ...overrides,
    },
    dependencies,
  );
  return { exitCode, stdout, stderr };
}

function fixtureDependencies(): Parameters<typeof runCli>[2] {
  const awaiting = createFixtureWorkspace(
    'awaiting_confirmation',
    'A normalized claim.',
  );
  return {
    openFramingRuntime: () =>
      Promise.resolve({
        framing: {
          begin: () => Promise.resolve(awaiting),
        },
        investigations: {
          confirmClaim: () =>
            createFixtureWorkspace('running', 'A normalized claim.'),
        },
        modelId: 'fixture-model',
        policy: {
          maxSearchRequests: 10,
          maxRetrievedSources: 20,
          maxTraversalDepth: 3,
          maxModelTokens: 50_000,
          maxWallClockMs: 300_000,
          perToolTimeoutMs: 10_000,
          maxRetries: 1,
          maxGraphNodes: 200,
        },
        dispose: () => Promise.resolve(),
      } as unknown as LocalFramingRuntime),
  };
}
