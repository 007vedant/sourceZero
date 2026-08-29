import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { z } from 'zod';

import {
  EVENT_SCHEMA_VERSION,
  INVESTIGATION_FORMAT_VERSION,
  isStatusChangedEvent,
  materializeEvent,
  parseInvestigationEvent,
  type InvestigationCreatedEventDraft,
  type InvestigationEvent,
  type InvestigationEventDraft,
} from '../domain/events.js';
import {
  artifactIdSchema,
  eventIdSchema,
  investigationIdSchema,
  type EventId,
  type InvestigationId,
} from '../domain/identifiers.js';
import { SecretRedactor } from '../domain/redaction.js';
import type { Disposable } from '../runtime/disposable.js';
import { PersistenceError } from './errors.js';
import {
  artifactRecordSchema,
  investigationRecordSchema,
  type ArtifactMetadataRepository,
  type ArtifactRecord,
  type InvestigationRecord,
} from './records.js';

const defaultMigrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

const investigationRowSchema = z.object({
  id: z.string(),
  format_version: z.number(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  last_sequence: z.number(),
});

const eventRowSchema = z.object({
  investigation_id: z.string(),
  sequence: z.number(),
  event_id: z.string(),
  type: z.string(),
  occurred_at: z.string(),
  schema_version: z.number(),
  producer_json: z.string(),
  causation_id: z.string().nullable(),
  correlation_id: z.string().nullable(),
  data_json: z.string(),
});

const artifactRowSchema = z.object({
  id: z.string(),
  algorithm: z.string(),
  media_type: z.string(),
  byte_length: z.number(),
  created_at: z.string(),
  retention_class: z.string(),
  relative_location: z.string(),
  format_version: z.number(),
});

export interface OpenSqliteStoreOptions {
  readonly databasePath: string;
  readonly migrationsFolder?: string;
  readonly redactor?: SecretRedactor;
  readonly clock?: () => Date;
}

export class SqliteStore implements Disposable, ArtifactMetadataRepository {
  readonly #database: DatabaseSync;
  readonly #redactor: SecretRedactor;
  readonly #clock: () => Date;
  readonly #insertEvent: StatementSync;
  #disposed = false;

  private constructor(
    database: DatabaseSync,
    redactor: SecretRedactor,
    clock: () => Date,
  ) {
    this.#database = database;
    this.#redactor = redactor;
    this.#clock = clock;
    this.#insertEvent = database.prepare(`
      INSERT INTO investigation_events (
        investigation_id, sequence, event_id, type, occurred_at,
        schema_version, producer_json, causation_id, correlation_id, data_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  public static async open(
    options: OpenSqliteStoreOptions,
  ): Promise<SqliteStore> {
    if (options.databasePath !== ':memory:') {
      await mkdir(dirname(resolve(options.databasePath)), { recursive: true });
    }

    const database = new DatabaseSync(options.databasePath);
    try {
      database.exec('PRAGMA foreign_keys = ON');
      database.exec('PRAGMA busy_timeout = 5000');
      if (options.databasePath !== ':memory:') {
        database.exec('PRAGMA journal_mode = WAL');
      }
      const migrationResult = migrate(drizzle({ client: database }), {
        migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
      });
      if (migrationResult !== undefined) {
        throw new PersistenceError(
          'invalid_persistence_data',
          'SQLite migrations could not be initialized.',
        );
      }
      return new SqliteStore(
        database,
        options.redactor ?? new SecretRedactor(),
        options.clock ?? (() => new Date()),
      );
    } catch (error: unknown) {
      database.close();
      throw error;
    }
  }

  public createInvestigation(
    investigationId: InvestigationId,
    draft: InvestigationCreatedEventDraft,
  ): InvestigationRecord {
    this.#assertActive();
    const event = materializeEvent(investigationId, 1, draft);
    if (event.type !== 'investigation.created') {
      throw new PersistenceError(
        'invalid_persistence_data',
        'An investigation must begin with investigation.created.',
      );
    }
    if (event.causationId !== undefined) {
      throw new PersistenceError(
        'invalid_event_causation',
        'The first investigation event cannot have a causation event.',
      );
    }
    this.#redactor.assertSafe(event, 'an investigation event');

    return this.#transaction(() => {
      const existing = this.#selectInvestigation(investigationId);
      if (existing !== undefined) {
        throw new PersistenceError(
          'investigation_already_exists',
          `Investigation "${investigationId}" already exists.`,
        );
      }

      this.#database
        .prepare(
          `INSERT INTO investigations
            (id, format_version, status, created_at, updated_at, last_sequence)
           VALUES (?, ?, 'draft', ?, ?, 1)`,
        )
        .run(
          investigationId,
          INVESTIGATION_FORMAT_VERSION,
          event.occurredAt,
          event.occurredAt,
        );
      this.#writeEvent(event);
      return this.#requireInvestigation(investigationId);
    });
  }

  public append(
    investigationId: InvestigationId,
    expectedPreviousSequence: number,
    drafts: readonly InvestigationEventDraft[],
  ): readonly InvestigationEvent[] {
    this.#assertActive();
    if (
      !Number.isInteger(expectedPreviousSequence) ||
      expectedPreviousSequence < 1
    ) {
      throw new PersistenceError(
        'stale_event_sequence',
        'Expected previous sequence must be a positive integer.',
      );
    }
    if (drafts.length === 0) {
      throw new PersistenceError(
        'invalid_persistence_data',
        'At least one event is required for append.',
      );
    }
    const events = drafts.map((draft, index) =>
      materializeEvent(
        investigationId,
        expectedPreviousSequence + index + 1,
        draft,
      ),
    );
    this.#redactor.assertSafe(events, 'investigation events');

    return this.#transaction(() => {
      const investigation = this.#selectInvestigation(investigationId);
      if (investigation === undefined) {
        throw new PersistenceError(
          'investigation_not_found',
          `Investigation "${investigationId}" does not exist.`,
        );
      }
      if (investigation.lastSequence !== expectedPreviousSequence) {
        throw new PersistenceError(
          'stale_event_sequence',
          `Expected sequence ${expectedPreviousSequence.toString()}, but investigation "${investigationId}" is at sequence ${investigation.lastSequence.toString()}.`,
        );
      }

      this.#validateCausation(events);
      let status = investigation.status;
      for (const event of events) {
        if (isStatusChangedEvent(event)) {
          if (event.data.from !== status) {
            throw new PersistenceError(
              'invalid_persistence_data',
              `Status event at sequence ${event.sequence.toString()} expected "${event.data.from}", but persisted status is "${status}".`,
            );
          }
          status = event.data.to;
        }
        this.#writeEvent(event);
      }

      this.#database
        .prepare(
          `UPDATE investigations
             SET status = ?, updated_at = ?, last_sequence = ?
           WHERE id = ? AND last_sequence = ?`,
        )
        .run(
          status,
          this.#clock().toISOString(),
          events.at(-1)?.sequence ?? expectedPreviousSequence,
          investigationId,
          expectedPreviousSequence,
        );
      return events;
    });
  }

  public getInvestigation(
    investigationId: InvestigationId,
  ): InvestigationRecord | undefined {
    this.#assertActive();
    return this.#selectInvestigation(investigationId);
  }

  public listInvestigations(): readonly InvestigationRecord[] {
    this.#assertActive();
    const rows = this.#database
      .prepare('SELECT * FROM investigations ORDER BY created_at, id')
      .all();
    return rows.map((row) => parseInvestigationRow(row));
  }

  public readEvents(
    investigationId: InvestigationId,
    afterSequence = 0,
  ): readonly InvestigationEvent[] {
    this.#assertActive();
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new PersistenceError(
        'invalid_persistence_data',
        'Event read watermark must be a non-negative integer.',
      );
    }
    if (this.#selectInvestigation(investigationId) === undefined) {
      throw new PersistenceError(
        'investigation_not_found',
        `Investigation "${investigationId}" does not exist.`,
      );
    }
    const rows = this.#database
      .prepare(
        `SELECT * FROM investigation_events
          WHERE investigation_id = ? AND sequence > ?
          ORDER BY sequence`,
      )
      .all(investigationId, afterSequence);
    return rows.map((row) => parseEventRow(row));
  }

  public getArtifact(id: ArtifactRecord['id']): ArtifactRecord | undefined {
    this.#assertActive();
    const row = this.#database
      .prepare('SELECT * FROM artifacts WHERE id = ?')
      .get(id);
    return row === undefined ? undefined : parseArtifactRow(row);
  }

  public putArtifact(record: ArtifactRecord): ArtifactRecord {
    this.#assertActive();
    const validated = parsePersistenceValue(
      artifactRecordSchema,
      record,
      'artifact metadata',
    );
    this.#redactor.assertSafe(validated, 'artifact metadata');
    const existing = this.getArtifact(validated.id);
    if (existing !== undefined) {
      if (!artifactMetadataMatches(existing, validated)) {
        throw new PersistenceError(
          'artifact_metadata_conflict',
          `Artifact "${validated.id}" already has different metadata.`,
        );
      }
      return existing;
    }

    try {
      this.#database
        .prepare(
          `INSERT INTO artifacts
            (id, algorithm, media_type, byte_length, created_at,
             retention_class, relative_location, format_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          validated.id,
          validated.algorithm,
          validated.mediaType,
          validated.byteLength,
          validated.createdAt,
          validated.retentionClass,
          validated.relativeLocation,
          validated.formatVersion,
        );
      return validated;
    } catch (error: unknown) {
      const concurrentlyInserted = this.getArtifact(validated.id);
      if (
        concurrentlyInserted !== undefined &&
        artifactMetadataMatches(concurrentlyInserted, validated)
      ) {
        return concurrentlyInserted;
      }
      throw new PersistenceError(
        'artifact_metadata_conflict',
        `Could not publish metadata for artifact "${validated.id}".`,
        { cause: error },
      );
    }
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#database.close();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new PersistenceError(
        'persistence_closed',
        'The SQLite store is closed.',
      );
    }
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#database.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  #selectInvestigation(
    investigationId: InvestigationId,
  ): InvestigationRecord | undefined {
    const row = this.#database
      .prepare('SELECT * FROM investigations WHERE id = ?')
      .get(investigationId);
    return row === undefined ? undefined : parseInvestigationRow(row);
  }

  #requireInvestigation(investigationId: InvestigationId): InvestigationRecord {
    const record = this.#selectInvestigation(investigationId);
    if (record === undefined) {
      throw new PersistenceError(
        'invalid_persistence_data',
        'Investigation metadata was not committed with its creation event.',
      );
    }
    return record;
  }

  #writeEvent(event: InvestigationEvent): void {
    try {
      this.#insertEvent.run(
        event.investigationId,
        event.sequence,
        event.eventId,
        event.type,
        event.occurredAt,
        event.schemaVersion,
        JSON.stringify(event.producer),
        event.causationId ?? null,
        event.correlationId ?? null,
        JSON.stringify(event.data),
      );
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new PersistenceError(
          'duplicate_event_id',
          `Event "${event.eventId}" is already stored.`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  #validateCausation(events: readonly InvestigationEvent[]): void {
    const knownInBatch = new Set<EventId>();
    for (const event of events) {
      if (event.causationId !== undefined) {
        const exists =
          knownInBatch.has(event.causationId) ||
          this.#database
            .prepare(
              `SELECT 1 FROM investigation_events
                WHERE event_id = ? AND investigation_id = ?`,
            )
            .get(event.causationId, event.investigationId) !== undefined;
        if (!exists) {
          throw new PersistenceError(
            'invalid_event_causation',
            `Event "${event.eventId}" references unknown causation event "${event.causationId}".`,
          );
        }
      }
      knownInBatch.add(event.eventId);
    }
  }
}

function parseInvestigationRow(row: unknown): InvestigationRecord {
  const parsed = parsePersistenceValue(
    investigationRowSchema,
    row,
    'investigation metadata',
  );
  if (parsed.format_version !== INVESTIGATION_FORMAT_VERSION) {
    throw new PersistenceError(
      'unsupported_format_version',
      `Investigation "${parsed.id}" uses unsupported format version ${parsed.format_version.toString()}.`,
    );
  }
  return parsePersistenceValue(
    investigationRecordSchema,
    {
      id: parsed.id,
      formatVersion: parsed.format_version,
      status: parsed.status,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
      lastSequence: parsed.last_sequence,
    },
    'investigation metadata',
  );
}

function parseEventRow(row: unknown): InvestigationEvent {
  const parsed = parsePersistenceValue(eventRowSchema, row, 'an event row');
  if (parsed.schema_version !== EVENT_SCHEMA_VERSION) {
    throw new PersistenceError(
      'unsupported_format_version',
      `Event "${parsed.event_id}" uses unsupported schema version ${parsed.schema_version.toString()}.`,
    );
  }
  try {
    return parseInvestigationEvent({
      investigationId: parsePersistenceValue(
        investigationIdSchema,
        parsed.investigation_id,
        'an investigation identifier',
      ),
      sequence: parsed.sequence,
      eventId: parsePersistenceValue(
        eventIdSchema,
        parsed.event_id,
        'an event identifier',
      ),
      type: parsed.type,
      occurredAt: parsed.occurred_at,
      schemaVersion: parsed.schema_version,
      producer: parseJson(parsed.producer_json),
      ...(parsed.causation_id === null
        ? {}
        : {
            causationId: parsePersistenceValue(
              eventIdSchema,
              parsed.causation_id,
              'a causation identifier',
            ),
          }),
      ...(parsed.correlation_id === null
        ? {}
        : { correlationId: parsed.correlation_id }),
      data: parseJson(parsed.data_json),
    });
  } catch {
    throw new PersistenceError(
      'invalid_persistence_data',
      'Stored investigation event failed runtime validation.',
    );
  }
}

function parseArtifactRow(row: unknown): ArtifactRecord {
  const parsed = parsePersistenceValue(
    artifactRowSchema,
    row,
    'artifact metadata',
  );
  return parsePersistenceValue(
    artifactRecordSchema,
    {
      id: parsePersistenceValue(
        artifactIdSchema,
        parsed.id,
        'an artifact identifier',
      ),
      algorithm: parsed.algorithm,
      mediaType: parsed.media_type,
      byteLength: parsed.byte_length,
      createdAt: parsed.created_at,
      retentionClass: parsed.retention_class,
      relativeLocation: parsed.relative_location,
      formatVersion: parsed.format_version,
    },
    'artifact metadata',
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error: unknown) {
    throw new PersistenceError(
      'invalid_persistence_data',
      'Stored persistence JSON is invalid.',
      { cause: error },
    );
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (('errcode' in error && error.errcode === 2067) ||
      ('message' in error &&
        typeof error.message === 'string' &&
        error.message.startsWith('UNIQUE constraint failed:')))
  );
}

function parsePersistenceValue<Output>(
  schema: z.ZodType<Output>,
  value: unknown,
  description: string,
): Output {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new PersistenceError(
      'invalid_persistence_data',
      `Stored ${description} failed runtime validation.`,
    );
  }
  return result.data;
}

function artifactMetadataMatches(
  left: ArtifactRecord,
  right: ArtifactRecord,
): boolean {
  return (
    left.id === right.id &&
    left.mediaType === right.mediaType &&
    left.byteLength === right.byteLength &&
    left.retentionClass === right.retentionClass &&
    left.relativeLocation === right.relativeLocation
  );
}
