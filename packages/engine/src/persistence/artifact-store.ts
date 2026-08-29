import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  artifactIdFromHexDigest,
  type ArtifactId,
} from '../domain/identifiers.js';
import { SecretRedactor } from '../domain/redaction.js';
import { PersistenceError } from './errors.js';
import {
  ARTIFACT_FORMAT_VERSION,
  artifactRecordSchema,
  type ArtifactMetadataRepository,
  type ArtifactRecord,
  type ArtifactRetentionClass,
} from './records.js';

export interface PutArtifactInput {
  readonly content: Uint8Array;
  readonly mediaType: string;
  readonly retentionClass: ArtifactRetentionClass;
  readonly signal?: AbortSignal;
}

export interface LocalArtifactStoreOptions {
  readonly rootDirectory: string;
  readonly metadata: ArtifactMetadataRepository;
  readonly maxArtifactBytes: number;
  readonly redactor?: SecretRedactor;
  readonly clock?: () => Date;
  readonly beforePublish?: (
    temporaryPath: string,
    finalPath: string,
  ) => void | Promise<void>;
}

export class LocalArtifactStore {
  readonly #rootDirectory: string;
  readonly #metadata: ArtifactMetadataRepository;
  readonly #maxArtifactBytes: number;
  readonly #redactor: SecretRedactor;
  readonly #clock: () => Date;
  readonly #beforePublish:
    | ((temporaryPath: string, finalPath: string) => void | Promise<void>)
    | undefined;

  public constructor(options: LocalArtifactStoreOptions) {
    if (
      !Number.isInteger(options.maxArtifactBytes) ||
      options.maxArtifactBytes <= 0
    ) {
      throw new TypeError('maxArtifactBytes must be a positive integer.');
    }
    this.#rootDirectory = resolve(options.rootDirectory);
    this.#metadata = options.metadata;
    this.#maxArtifactBytes = options.maxArtifactBytes;
    this.#redactor = options.redactor ?? new SecretRedactor();
    this.#clock = options.clock ?? (() => new Date());
    this.#beforePublish = options.beforePublish;
  }

  public async put(input: PutArtifactInput): Promise<ArtifactRecord> {
    input.signal?.throwIfAborted();
    if (input.content.byteLength > this.#maxArtifactBytes) {
      throw new PersistenceError(
        'artifact_too_large',
        `Artifact is ${input.content.byteLength.toString()} bytes; the configured maximum is ${this.#maxArtifactBytes.toString()} bytes.`,
      );
    }
    this.#redactor.assertBytesSafe(input.content, 'an artifact');

    const digest = hash(input.content);
    const id = artifactIdFromHexDigest(digest);
    const relativeLocation = `sha256/${digest.slice(0, 2)}/${digest.slice(2, 4)}/${digest}`;
    const finalPath = join(this.#rootDirectory, relativeLocation);
    const record = artifactRecordSchema.parse({
      id,
      algorithm: 'sha256',
      mediaType: input.mediaType,
      byteLength: input.content.byteLength,
      createdAt: this.#clock().toISOString(),
      retentionClass: input.retentionClass,
      relativeLocation,
      formatVersion: ARTIFACT_FORMAT_VERSION,
    });

    const existing = this.#metadata.getArtifact(id);
    if (existing !== undefined) {
      assertSameMetadata(existing, record);
      await this.#verifyFile(existing, input.signal);
      return existing;
    }

    const targetDirectory = join(
      this.#rootDirectory,
      'sha256',
      digest.slice(0, 2),
      digest.slice(2, 4),
    );
    await mkdir(targetDirectory, { recursive: true });
    input.signal?.throwIfAborted();
    const temporaryPath = join(
      targetDirectory,
      `.${digest}.${randomUUID()}.tmp`,
    );

    try {
      const handle = await open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(input.content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      input.signal?.throwIfAborted();
      const written = await readFile(temporaryPath);
      if (
        written.byteLength !== input.content.byteLength ||
        hash(written) !== digest
      ) {
        throw new PersistenceError(
          'artifact_integrity_failure',
          `Temporary content verification failed for artifact "${id}".`,
        );
      }
      await this.#beforePublish?.(temporaryPath, finalPath);
      input.signal?.throwIfAborted();
      await rename(temporaryPath, finalPath);
    } catch (error: unknown) {
      await rm(temporaryPath, { force: true });
      throw error;
    }

    return this.#metadata.putArtifact(record);
  }

  public async read(id: ArtifactId, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    const record = this.#metadata.getArtifact(id);
    if (record === undefined) {
      throw new PersistenceError(
        'artifact_integrity_failure',
        `Artifact "${id}" has no published metadata.`,
      );
    }
    return this.#readAndVerify(record, signal);
  }

  async #verifyFile(
    record: ArtifactRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#readAndVerify(record, signal);
  }

  async #readAndVerify(
    record: ArtifactRecord,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    signal?.throwIfAborted();
    let content: Uint8Array;
    try {
      content = await readFile(
        join(this.#rootDirectory, record.relativeLocation),
      );
    } catch (error: unknown) {
      throw new PersistenceError(
        'artifact_integrity_failure',
        `Artifact "${record.id}" is missing from the artifact store.`,
        { cause: error },
      );
    }
    signal?.throwIfAborted();
    const expectedDigest = record.id.slice('sha256:'.length);
    if (
      content.byteLength !== record.byteLength ||
      hash(content) !== expectedDigest
    ) {
      throw new PersistenceError(
        'artifact_integrity_failure',
        `Artifact "${record.id}" failed content verification.`,
      );
    }
    return new Uint8Array(content);
  }
}

function hash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function assertSameMetadata(
  existing: ArtifactRecord,
  proposed: ArtifactRecord,
): void {
  const stableExisting = { ...existing, createdAt: proposed.createdAt };
  if (JSON.stringify(stableExisting) !== JSON.stringify(proposed)) {
    throw new PersistenceError(
      'artifact_metadata_conflict',
      `Artifact "${existing.id}" already exists with different metadata.`,
    );
  }
}
