/** Verifies durable causal traversal, budgets, artifacts, and replay projections. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DurableHarnessEventRecorder,
  InMemoryBudgetAccountant,
  ToolExecutor,
  ToolRegistry,
  extractionRequestSchema,
  extractionResponseSchema,
  fetchRequestSchema,
  fetchResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
} from '../harness/index.js';
import { LocalArtifactStore } from '../persistence/artifact-store.js';
import { SqliteStore } from '../persistence/sqlite-store.js';
import { PluginRuntime } from '../runtime/plugin-runtime.js';
import { CommittedEventBus } from './event-stream.js';
import { foundationalProjectionsPlugin } from './foundational-projections.js';
import { InvestigationApplicationService } from './investigation-service.js';
import { SourceDiscoveryService } from './source-discovery-service.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('SourceDiscoveryService', () => {
  it('records a causal bounded traversal whose artifact references and projections replay', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sourcezero-discovery-'));
    directories.push(directory);
    const databasePath = join(directory, 'sourcezero.db');
    const artifactPath = join(directory, 'artifacts');
    const store = await SqliteStore.open({ databasePath });
    const artifacts = new LocalArtifactStore({
      rootDirectory: artifactPath,
      metadata: store,
      maxArtifactBytes: 1_000_000,
    });
    const raw = await artifacts.put({
      content: new TextEncoder().encode('<main>raw</main>'),
      mediaType: 'text/html',
      retentionClass: 'investigation',
    });
    const readable = await artifacts.put({
      content: new TextEncoder().encode('Durable readable evidence.'),
      mediaType: 'text/plain',
      retentionClass: 'investigation',
    });
    const runtime = await PluginRuntime.boot([foundationalProjectionsPlugin]);
    const eventBus = new CommittedEventBus();
    const investigations = new InvestigationApplicationService({
      persistence: store,
      projections: runtime.getProjectionRegistry(),
      eventBus,
    });
    const recorder = new DurableHarnessEventRecorder({
      repository: store,
      onCommitted: (events) => eventBus.publish(events),
    });
    const registry = new ToolRegistry();
    registry.register({
      name: 'provider.search.query',
      description: 'Fixture source discovery.',
      inputSchema: searchRequestSchema,
      outputSchema: searchResponseSchema,
      timeoutMs: 1_000,
      retryPolicy: noRetries,
      budget: { perAttempt: { searchRequests: 1 } },
      execute: () =>
        Promise.resolve({
          results: [
            {
              url: 'https://one.example/article#fragment',
              title: 'One',
              snippet: 'First',
            },
            {
              url: 'https://two.example/article',
              title: 'Two',
              snippet: 'Second',
            },
          ],
        }),
    });
    registry.register({
      name: 'provider.fetch.public_url',
      description: 'Fixture safe retrieval.',
      inputSchema: fetchRequestSchema,
      outputSchema: fetchResponseSchema,
      timeoutMs: 1_000,
      retryPolicy: noRetries,
      budget: {
        estimate: () => ({ retrievedSources: 1 }),
        measure: (_request, response) =>
          response.outcome === 'retrieved' ? { retrievedSources: 1 } : {},
      },
      execute: () =>
        Promise.resolve({
          outcome: 'retrieved' as const,
          resolvedUrl: 'https://one.example/article',
          status: 200,
          mediaType: 'text/html',
          artifactId: raw.id,
          byteLength: raw.byteLength,
          redirects: [],
        }),
    });
    registry.register({
      name: 'provider.extraction.readable_text',
      description: 'Fixture lead extraction.',
      inputSchema: extractionRequestSchema,
      outputSchema: extractionResponseSchema,
      timeoutMs: 1_000,
      retryPolicy: noRetries,
      execute: () =>
        Promise.resolve({
          title: 'One',
          readableTextArtifactId: readable.id,
          readableCharacterCount: 26,
          links: [
            {
              url: 'https://one.example/article#other',
              text: 'Duplicate',
              kind: 'hyperlink' as const,
            },
            {
              url: 'https://deep.example/page',
              text: 'Deep citation',
              kind: 'citation' as const,
            },
          ],
          namedSources: ['Named Journal'],
          exactPhrases: ['A sufficiently long exact phrase lead'],
          metadata: { author: 'Named Journal' },
          extractionMethod: 'static' as const,
        }),
    });
    const executor = new ToolExecutor({
      registry,
      recorder,
      budget: new InMemoryBudgetAccountant({
        searchRequests: 1,
        retrievedSources: 1,
        wallClockMs: 60_000,
      }),
    });
    const created = investigations.createInvestigation({
      originalInput: { kind: 'claim', claim: 'A claim.' },
    });
    investigations.resolvePolicy(created.investigationId, policy);
    const framed = investigations.recordClaimProposals(
      created.investigationId,
      {
        proposals: [
          {
            wording: 'A confirmed factual claim.',
            origin: 'manual_normalization',
          },
        ],
      },
    );
    const working = framed.framing.workingClaim;
    if (working === undefined) throw new Error('Fixture proposal is missing.');
    investigations.confirmClaim(created.investigationId, working);
    const discovery = new SourceDiscoveryService({
      investigations,
      executor,
      recorder,
    });

    const workspace = await discovery.run(
      created.investigationId,
      new AbortController().signal,
    );
    expect(workspace.overview.sourceCount).toBe(1);
    expect(workspace.limitations.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['source_budget', 'duplicate', 'depth_budget']),
    );
    const inspection = investigations.inspectInvestigation(
      created.investigationId,
    );
    const query = inspection.events.find(
      (event) => event.type === 'discovery.query_recorded',
    );
    const lead = inspection.events.find(
      (event) => event.type === 'discovery.lead_recorded',
    );
    const searchRequest = inspection.events.find(
      (event) =>
        event.type === 'tool.requested' &&
        event.data.toolName === 'provider.search.query',
    );
    const fetchRequest = inspection.events.find(
      (event) =>
        event.type === 'tool.requested' &&
        event.data.toolName === 'provider.fetch.public_url',
    );
    const source = inspection.events.find(
      (event) => event.type === 'source.retrieved',
    );
    expect(searchRequest?.causationId).toBe(query?.eventId);
    expect(fetchRequest?.causationId).toBe(lead?.eventId);
    expect(source?.causationId).toBe(lead?.eventId);
    expect(source?.data).toMatchObject({
      fetchedArtifactId: raw.id,
      readableTextArtifactId: readable.id,
      normalizedUrl: 'https://one.example/article',
      namedSources: ['Named Journal'],
    });
    const expectedRaw = await artifacts.read(raw.id);
    const expectedReadable = await artifacts.read(readable.id);

    registry.dispose();
    await runtime.dispose();
    store.dispose();

    const reopened = await SqliteStore.open({ databasePath });
    const replayRuntime = await PluginRuntime.boot([
      foundationalProjectionsPlugin,
    ]);
    const replay = new InvestigationApplicationService({
      persistence: reopened,
      projections: replayRuntime.getProjectionRegistry(),
    });
    expect(replay.showInvestigation(created.investigationId)).toMatchObject({
      overview: { sourceCount: 1 },
      limitations: {
        items: expect.arrayContaining([
          expect.objectContaining({ kind: 'source_budget' }),
        ]),
      },
    });
    const reopenedArtifacts = new LocalArtifactStore({
      rootDirectory: artifactPath,
      metadata: reopened,
      maxArtifactBytes: 1_000_000,
    });
    await expect(reopenedArtifacts.read(raw.id)).resolves.toEqual(expectedRaw);
    await expect(reopenedArtifacts.read(readable.id)).resolves.toEqual(
      expectedReadable,
    );
    await replayRuntime.dispose();
    reopened.dispose();
  });
});

const noRetries = {
  maxRetries: 0,
  delayMs: 0,
  retryableFailureCodes: [],
} as const;
const policy = {
  maxSearchRequests: 1,
  maxRetrievedSources: 1,
  maxTraversalDepth: 0,
  maxModelTokens: 1_000,
  maxWallClockMs: 60_000,
  perToolTimeoutMs: 1_000,
  maxRetries: 0,
  maxGraphNodes: 20,
};
