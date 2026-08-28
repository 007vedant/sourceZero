import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

import { RuntimeError } from './errors.js';

const sourceZeroConfigSchema = z
  .object({
    configVersion: z.literal(1).default(1),
    runtime: z
      .object({
        logLevel: z
          .enum(['silent', 'error', 'warn', 'info', 'debug'])
          .default('info'),
      })
      .strict()
      .default({ logLevel: 'info' }),
  })
  .strict();

export type SourceZeroConfig = z.output<typeof sourceZeroConfigSchema>;

export interface LoadConfigurationOptions {
  readonly path?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly workingDirectory?: string;
}

export async function loadLocalConfiguration(
  options: LoadConfigurationOptions = {},
): Promise<SourceZeroConfig> {
  const environment = options.environment ?? process.env;
  const configuredPath = options.path ?? environment.SOURCEZERO_CONFIG;
  let input: unknown = {};

  if (configuredPath !== undefined) {
    const absolutePath = resolve(
      options.workingDirectory ?? process.cwd(),
      configuredPath,
    );
    try {
      input = JSON.parse(await readFile(absolutePath, 'utf8')) as unknown;
    } catch (error: unknown) {
      throw new RuntimeError(
        'invalid_configuration',
        `Unable to read a valid JSON configuration from "${absolutePath}".`,
        { cause: error },
      );
    }
  }

  const result = sourceZeroConfigSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    });
    throw new RuntimeError(
      'invalid_configuration',
      `Invalid SourceZero configuration:\n${issues.join('\n')}`,
    );
  }

  return result.data;
}
