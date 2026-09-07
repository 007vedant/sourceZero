/** Verifies terminal mode selection and ANSI-safe CLI output contracts. */

import { describe, expect, it } from 'vitest';

import { runCli, type CliIo } from './index.js';

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
});

async function captureCli(
  args: readonly string[],
  overrides: Partial<CliIo> = {},
): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli(args, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    ...overrides,
  });
  return { exitCode, stdout, stderr };
}
