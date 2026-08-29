import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { SecretRedactor } from '../domain/redaction.js';
import { createInvestigationId } from '../domain/identifiers.js';
import { SqliteStore } from './sqlite-store.js';
import {
  investigationCreatedDraft,
  policyResolvedDraft,
  statusChangedDraft,
} from './test-fixtures.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sourcezero-events-'));
  temporaryDirectories.push(directory);
  return join(directory, 'sourcezero.db');
}

describe('SqliteStore', () => {
  it('creates, appends, lists, and reads a contiguous event stream', async () => {
    const store = await SqliteStore.open({
      databasePath: await databasePath(),
    });
    const investigationId = createInvestigationId();
    const created = investigationCreatedDraft();
    store.createInvestigation(investigationId, created);

    const appended = store.append(investigationId, 1, [
      policyResolvedDraft(),
      statusChangedDraft(),
    ]);

    expect(appended.map((event) => event.sequence)).toEqual([2, 3]);
    expect(store.readEvents(investigationId)).toEqual([
      expect.objectContaining({ eventId: created.eventId, sequence: 1 }),
      ...appended,
    ]);
    expect(store.getInvestigation(investigationId)).toMatchObject({
      lastSequence: 3,
      status: 'awaiting_confirmation',
    });
    expect(store.listInvestigations()).toHaveLength(1);
    store.dispose();
  });

  it('rejects stale writers without creating a gap or duplicate sequence', async () => {
    const path = await databasePath();
    const first = await SqliteStore.open({ databasePath: path });
    const investigationId = createInvestigationId();
    first.createInvestigation(investigationId, investigationCreatedDraft());
    const second = await SqliteStore.open({ databasePath: path });

    first.append(investigationId, 1, [policyResolvedDraft()]);
    expect(() =>
      second.append(investigationId, 1, [policyResolvedDraft()]),
    ).toThrowError(expect.objectContaining({ code: 'stale_event_sequence' }));

    expect(
      first.readEvents(investigationId).map((event) => event.sequence),
    ).toEqual([1, 2]);
    first.dispose();
    second.dispose();
  });

  it('rolls back a batch containing a duplicate event ID', async () => {
    const store = await SqliteStore.open({
      databasePath: await databasePath(),
    });
    const investigationId = createInvestigationId();
    store.createInvestigation(investigationId, investigationCreatedDraft());
    const duplicate = policyResolvedDraft();

    expect(() =>
      store.append(investigationId, 1, [duplicate, duplicate]),
    ).toThrowError(expect.objectContaining({ code: 'duplicate_event_id' }));
    expect(store.getInvestigation(investigationId)?.lastSequence).toBe(1);
    expect(store.readEvents(investigationId)).toHaveLength(1);
    store.dispose();
  });

  it('reloads the exact committed event stream after restart', async () => {
    const path = await databasePath();
    const investigationId = createInvestigationId();
    const first = await SqliteStore.open({ databasePath: path });
    first.createInvestigation(investigationId, investigationCreatedDraft());
    first.append(investigationId, 1, [policyResolvedDraft()]);
    const beforeRestart = first.readEvents(investigationId);
    first.dispose();

    const reopened = await SqliteStore.open({ databasePath: path });
    expect(reopened.readEvents(investigationId)).toEqual(beforeRestart);
    expect(reopened.getInvestigation(investigationId)?.lastSequence).toBe(2);
    reopened.dispose();
  });

  it('rejects unknown causation and secret-bearing events atomically', async () => {
    const store = await SqliteStore.open({
      databasePath: await databasePath(),
      redactor: new SecretRedactor(['provider-secret']),
    });
    const investigationId = createInvestigationId();
    store.createInvestigation(investigationId, investigationCreatedDraft());
    const otherInvestigationId = createInvestigationId();
    const otherCreated = investigationCreatedDraft();
    store.createInvestigation(otherInvestigationId, otherCreated);
    const unknownCausation = {
      ...policyResolvedDraft(),
      causationId: otherCreated.eventId,
    };
    expect(() =>
      store.append(investigationId, 1, [unknownCausation]),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_event_causation' }),
    );
    expect(() =>
      store.append(investigationId, 1, [statusChangedDraft('provider-secret')]),
    ).toThrowError(
      expect.objectContaining({ code: 'unsafe_persistence_value' }),
    );
    expect(store.readEvents(investigationId)).toHaveLength(1);
    store.dispose();
  });

  it('uses WAL and rejects unsupported stored format versions', async () => {
    const path = await databasePath();
    const investigationId = createInvestigationId();
    const store = await SqliteStore.open({ databasePath: path });
    store.createInvestigation(investigationId, investigationCreatedDraft());
    const inspector = new DatabaseSync(path);
    expect(inspector.prepare('PRAGMA journal_mode').get()).toMatchObject({
      journal_mode: 'wal',
    });
    inspector
      .prepare('UPDATE investigations SET format_version = 999 WHERE id = ?')
      .run(investigationId);
    expect(() => store.getInvestigation(investigationId)).toThrowError(
      expect.objectContaining({ code: 'unsupported_format_version' }),
    );
    inspector.close();
    store.dispose();
  });
});
