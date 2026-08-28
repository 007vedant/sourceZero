import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadLocalConfiguration } from './configuration.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function writeConfiguration(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sourcezero-config-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'config.json');
  await writeFile(path, contents, 'utf8');
  return path;
}

describe('loadLocalConfiguration', () => {
  it('resolves safe defaults when no file is configured', async () => {
    await expect(loadLocalConfiguration({ environment: {} })).resolves.toEqual({
      configVersion: 1,
      runtime: { logLevel: 'info' },
    });
  });

  it('loads and validates a local JSON configuration', async () => {
    const path = await writeConfiguration(
      JSON.stringify({ configVersion: 1, runtime: { logLevel: 'debug' } }),
    );

    await expect(loadLocalConfiguration({ path })).resolves.toEqual({
      configVersion: 1,
      runtime: { logLevel: 'debug' },
    });
  });

  it('reports invalid fields without including secret values', async () => {
    const secret = 'do-not-print-this-token';
    const path = await writeConfiguration(
      JSON.stringify({ configVersion: 1, apiToken: secret }),
    );

    const error = await loadLocalConfiguration({ path }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ code: 'invalid_configuration' });
    expect(String(error)).not.toContain(secret);
  });
});
