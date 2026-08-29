import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { artifactIdFromHexDigest } from '../domain/identifiers.js';
import { SecretRedactor } from '../domain/redaction.js';
import { LocalArtifactStore } from './artifact-store.js';
import { SqliteStore } from './sqlite-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function workspace(): Promise<{
  readonly directory: string;
  readonly databasePath: string;
  readonly artifactPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'sourcezero-artifacts-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    databasePath: join(directory, 'sourcezero.db'),
    artifactPath: join(directory, 'artifacts'),
  };
}

describe('LocalArtifactStore', () => {
  it('atomically stores, verifies, and reloads content-addressed artifacts', async () => {
    const paths = await workspace();
    const metadata = await SqliteStore.open({
      databasePath: paths.databasePath,
    });
    const artifacts = new LocalArtifactStore({
      rootDirectory: paths.artifactPath,
      metadata,
      maxArtifactBytes: 1_024,
    });
    const content = new TextEncoder().encode('durable fixture content');

    const record = await artifacts.put({
      content,
      mediaType: 'text/plain',
      retentionClass: 'investigation',
    });

    expect(record.id).toBe(digestId(content));
    await expect(artifacts.read(record.id)).resolves.toEqual(content);
    expect(
      await readFile(join(paths.artifactPath, record.relativeLocation)),
    ).toEqual(Buffer.from(content));
    metadata.dispose();

    const reopenedMetadata = await SqliteStore.open({
      databasePath: paths.databasePath,
    });
    const reopenedArtifacts = new LocalArtifactStore({
      rootDirectory: paths.artifactPath,
      metadata: reopenedMetadata,
      maxArtifactBytes: 1_024,
    });
    await expect(reopenedArtifacts.read(record.id)).resolves.toEqual(content);
    reopenedMetadata.dispose();
  });

  it('does not publish metadata when a file write cannot be published', async () => {
    const paths = await workspace();
    const metadata = await SqliteStore.open({
      databasePath: paths.databasePath,
    });
    const content = new TextEncoder().encode('will fail before rename');
    const id = digestId(content);
    const artifacts = new LocalArtifactStore({
      rootDirectory: paths.artifactPath,
      metadata,
      maxArtifactBytes: 1_024,
      beforePublish() {
        throw new Error('simulated publication failure');
      },
    });

    await expect(
      artifacts.put({
        content,
        mediaType: 'text/plain',
        retentionClass: 'transient',
      }),
    ).rejects.toThrow('simulated publication failure');
    expect(metadata.getArtifact(id)).toBeUndefined();
    metadata.dispose();
  });

  it('rejects oversized and secret-bearing artifacts before publication', async () => {
    const paths = await workspace();
    const metadata = await SqliteStore.open({
      databasePath: paths.databasePath,
    });
    const artifacts = new LocalArtifactStore({
      rootDirectory: paths.artifactPath,
      metadata,
      maxArtifactBytes: 4,
      redactor: new SecretRedactor(['key!']),
    });

    await expect(
      artifacts.put({
        content: new TextEncoder().encode('12345'),
        mediaType: 'text/plain',
        retentionClass: 'transient',
      }),
    ).rejects.toMatchObject({ code: 'artifact_too_large' });
    await expect(
      artifacts.put({
        content: new TextEncoder().encode('key!'),
        mediaType: 'text/plain',
        retentionClass: 'transient',
      }),
    ).rejects.toMatchObject({ code: 'unsafe_persistence_value' });
    metadata.dispose();
  });

  it('detects a modified artifact instead of returning corrupted content', async () => {
    const paths = await workspace();
    const metadata = await SqliteStore.open({
      databasePath: paths.databasePath,
    });
    const artifacts = new LocalArtifactStore({
      rootDirectory: paths.artifactPath,
      metadata,
      maxArtifactBytes: 1_024,
    });
    const record = await artifacts.put({
      content: new TextEncoder().encode('original'),
      mediaType: 'text/plain',
      retentionClass: 'investigation',
    });
    await writeFile(
      join(paths.artifactPath, record.relativeLocation),
      'tampered',
    );

    await expect(artifacts.read(record.id)).rejects.toMatchObject({
      code: 'artifact_integrity_failure',
    });
    metadata.dispose();
  });
});

function digestId(content: Uint8Array) {
  return artifactIdFromHexDigest(
    createHash('sha256').update(content).digest('hex'),
  );
}
