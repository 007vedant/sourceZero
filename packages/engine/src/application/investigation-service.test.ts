/** Verifies assembled create, list, show, inspect, and observe application behavior. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteStore } from '../persistence/sqlite-store.js';
import { PluginRuntime } from '../runtime/plugin-runtime.js';
import { foundationalProjectionsPlugin } from './foundational-projections.js';
import {
  ApplicationError,
  InvestigationApplicationService,
} from './investigation-service.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('InvestigationApplicationService', () => {
  it('creates and consistently exposes list, workspace, and inspection views', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sourcezero-application-'));
    temporaryDirectories.push(directory);
    const store = await SqliteStore.open({
      databasePath: join(directory, 'sourcezero.db'),
    });
    const runtime = await PluginRuntime.boot([foundationalProjectionsPlugin]);
    const service = new InvestigationApplicationService({
      persistence: store,
      projections: runtime.getProjectionRegistry(),
      clock: () => new Date('2026-08-29T10:00:00.000Z'),
    });

    const created = service.createInvestigation({
      originalInput: { kind: 'claim', claim: 'A reviewable claim.' },
      userId: 'reviewer',
    });
    const shown = service.showInvestigation(created.investigationId);
    const inspected = service.inspectInvestigation(created.investigationId);

    expect(created).toMatchObject({
      overview: {
        status: 'draft',
        originalInput: { kind: 'claim', claim: 'A reviewable claim.' },
        sourceCount: 0,
      },
      progress: { stage: 'framing' },
      framing: { proposals: [] },
      budget: { configured: false },
      graph: { nodes: [], edges: [] },
      trace: { entries: [{ sequence: 1, type: 'investigation.created' }] },
    });
    expect(shown).toEqual(created);
    expect(service.listInvestigations()).toEqual([
      expect.objectContaining({
        investigationId: created.investigationId,
        status: 'draft',
        lastSequence: 1,
      }),
    ]);
    expect(inspected.events).toHaveLength(1);
    expect(Object.values(inspected.projectionWatermarks)).toEqual(
      expect.arrayContaining([1]),
    );

    const subscription = service.observeInvestigation(created.investigationId);
    await expect(subscription.next()).resolves.toMatchObject({
      done: false,
      value: { sequence: 1 },
    });
    subscription.dispose();
    await runtime.dispose();
    store.dispose();
  });

  it('rejects invalid creation input without echoing it in diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sourcezero-application-'));
    temporaryDirectories.push(directory);
    const store = await SqliteStore.open({
      databasePath: join(directory, 'sourcezero.db'),
    });
    const runtime = await PluginRuntime.boot([foundationalProjectionsPlugin]);
    const service = new InvestigationApplicationService({
      persistence: store,
      projections: runtime.getProjectionRegistry(),
    });
    const secret = 'do-not-echo-this';

    const error = captureError(() =>
      service.createInvestigation({ authorization: secret }),
    );

    expect(error).toMatchObject({ code: 'invalid_command' });
    expect(String(error)).not.toContain(secret);
    await runtime.dispose();
    store.dispose();
  });

  it('durably proposes, edits, confirms, restarts, and branches claims through legal actions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sourcezero-application-'));
    temporaryDirectories.push(directory);
    const store = await SqliteStore.open({
      databasePath: join(directory, 'sourcezero.db'),
    });
    const runtime = await PluginRuntime.boot([foundationalProjectionsPlugin]);
    const service = new InvestigationApplicationService({
      persistence: store,
      projections: runtime.getProjectionRegistry(),
      clock: () => new Date('2026-10-02T10:00:00.000Z'),
    });
    const created = service.createInvestigation({
      originalInput: { kind: 'claim', claim: '  Original wording.  ' },
    });
    service.resolvePolicy(created.investigationId, fixturePolicy);
    const proposed = service.recordClaimProposals(created.investigationId, {
      proposals: [
        {
          wording: 'Normalized wording.',
          origin: 'manual_normalization',
        },
      ],
    });
    const initial = proposed.framing.workingClaim;
    expect(proposed.overview).toMatchObject({
      status: 'awaiting_confirmation',
      originalInput: { kind: 'claim', claim: '  Original wording.  ' },
    });
    expect(initial).toBeDefined();

    const edited = service.editClaim(created.investigationId, {
      wording: 'User-edited wording.',
    });
    const working = edited.framing.workingClaim;
    expect(working?.wording).toBe('User-edited wording.');
    const running = service.confirmClaim(created.investigationId, working);

    expect(running).toMatchObject({
      overview: { status: 'running' },
      progress: { stage: 'investigating' },
      framing: { confirmedClaim: working },
    });
    expect(() =>
      service.editClaim(created.investigationId, { wording: 'Silent change.' }),
    ).toThrowError(ApplicationError);

    const restarted = service.reframeClaim(created.investigationId, {
      wording: 'Explicit restart wording.',
      mode: 'restart',
    });
    expect(restarted).toMatchObject({
      overview: { status: 'awaiting_confirmation' },
      framing: { workingClaim: { wording: 'Explicit restart wording.' } },
    });
    const restartedClaim = restarted.framing.workingClaim;
    if (restartedClaim === undefined)
      throw new Error('Missing restarted claim.');
    service.confirmClaim(created.investigationId, restartedClaim);

    const branch = service.reframeClaim(created.investigationId, {
      wording: 'Branched wording.',
      mode: 'branch',
    });
    expect(branch.investigationId).not.toBe(created.investigationId);
    expect(branch).toMatchObject({
      overview: { status: 'awaiting_confirmation' },
      framing: { workingClaim: { wording: 'Branched wording.' } },
      budget: { configured: true },
    });
    expect(
      service
        .inspectInvestigation(created.investigationId)
        .events.map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        'claim.proposals_recorded',
        'claim.edited',
        'claim.confirmed',
        'claim.reframed',
      ]),
    );
    expect(
      service
        .inspectInvestigation(branch.investigationId)
        .events.map((event) => event.type),
    ).toContain('investigation.branched');

    await runtime.dispose();
    store.dispose();
  });
});

const fixturePolicy = {
  maxSearchRequests: 10,
  maxRetrievedSources: 20,
  maxTraversalDepth: 3,
  maxModelTokens: 50_000,
  maxWallClockMs: 300_000,
  perToolTimeoutMs: 10_000,
  maxRetries: 1,
  maxGraphNodes: 200,
};

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected action to throw.');
}
