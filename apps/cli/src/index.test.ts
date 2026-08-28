import { describe, expect, it } from 'vitest';

import { runCli } from './index.js';

describe('sourcezero CLI', () => {
  it('boots a fixture runtime and exits cleanly', async () => {
    let stdout = '';
    let stderr = '';

    const exitCode = await runCli([], {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toBe('SourceZero runtime ready.\n');
    expect(stderr).toBe('');
  });
});
