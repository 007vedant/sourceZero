/** Verifies end-to-end fixture claim framing, failures, durability, and latency. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it } from 'vitest';

import {
  InMemoryBudgetAccountant,
  ToolExecutor,
  ToolRegistry,
  extractionRequestSchema,
  extractionResponseSchema,
  fetchRequestSchema,
  fetchResponseSchema,
  modelRequestSchema,
  modelResponseSchema,
} from '../harness/index.js';
import { LocalArtifactStore } from '../persistence/artifact-store.js';
import { SqliteStore } from '../persistence/sqlite-store.js';
import { PluginRuntime } from '../runtime/plugin-runtime.js';
import { ClaimFramingService } from './claim-framing-service.js';
import { CommittedEventBus } from './event-stream.js';
import { foundationalProjectionsPlugin } from './foundational-projections.js';
import { InvestigationApplicationService } from './investigation-service.js';
import { DurableHarnessEventRecorder } from '../harness/event-recorder.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('ClaimFramingService', () => {
  it('frames and confirms a manual claim without scheduling non-framing work', async () => {
    const fixture = await createFixture(
      JSON.stringify({ claims: ['A precise normalized claim.'] }),
    );
    const startedAt = performance.now();
    const framed = await fixture.framing.begin({
      originalInput: { kind: 'claim', claim: '  a rough claim  ' },
      policy: fixturePolicy,
      modelId: 'fixture-model',
      signal: new AbortController().signal,
    });

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(framed).toMatchObject({
      overview: {
        status: 'awaiting_confirmation',
        originalInput: { kind: 'claim', claim: '  a rough claim  ' },
      },
      framing: {
        workingClaim: { wording: 'A precise normalized claim.' },
      },
    });
    expect(fixture.calls).toEqual(['provider.model.complete']);

    const working = framed.framing.workingClaim;
    if (working === undefined) throw new Error('Missing framing proposal.');
    const running = fixture.investigations.confirmClaim(
      framed.investigationId,
      working,
    );
    expect(running.overview.status).toBe('running');
    expect(
      fixture.investigations
        .inspectInvestigation(framed.investigationId)
        .events.map((event) => event.type),
    ).toEqual([
      'investigation.created',
      'investigation.policy_resolved',
      'tool.requested',
      'tool.started',
      'tool.succeeded',
      'budget.consumed',
      'claim.proposals_recorded',
      'investigation.status_changed',
      'claim.confirmed',
      'investigation.status_changed',
      'investigation.status_changed',
    ]);
    await fixture.dispose();
  });

  it('retrieves URL context and records at most five durable proposals', async () => {
    const fixture = await createFixture(
      JSON.stringify({
        claims: [
          'First page claim.',
          'Second page claim.',
          'Third page claim.',
          'Fourth page claim.',
          'Fifth page claim.',
        ],
      }),
    );
    const framed = await fixture.framing.begin({
      originalInput: { kind: 'url', url: 'https://example.test/article' },
      policy: fixturePolicy,
      modelId: 'fixture-model',
      signal: new AbortController().signal,
    });

    expect(fixture.calls).toEqual([
      'provider.fetch.public_url',
      'provider.extraction.readable_text',
      'provider.model.complete',
    ]);
    expect(framed.framing.proposals).toHaveLength(5);
    expect(framed.framing.pageContext).toMatchObject({
      requestedUrl: 'https://example.test/article',
      resolvedUrl: 'https://example.test/final',
      title: 'Fixture article',
      readableCharacterCount: 52,
    });
    expect(
      fixture.investigations
        .inspectInvestigation(framed.investigationId)
        .events.map((event) => event.type),
    ).toContain('framing.page_context_recorded');
    await fixture.dispose();
  });

  it('records malformed model output as a structured terminal framing failure', async () => {
    const fixture = await createFixture('not valid JSON');
    const framed = await fixture.framing.begin({
      originalInput: { kind: 'claim', claim: 'A rough claim.' },
      policy: fixturePolicy,
      modelId: 'fixture-model',
      signal: new AbortController().signal,
    });

    expect(framed).toMatchObject({
      overview: { status: 'failed' },
      framing: {
        failure: {
          code: 'invalid_model_output',
          stage: 'proposal',
        },
      },
    });
    await fixture.dispose();
  });
});

async function createFixture(modelText: string) {
  const directory = await mkdtemp(join(tmpdir(), 'sourcezero-framing-'));
  temporaryDirectories.push(directory);
  const store = await SqliteStore.open({
    databasePath: join(directory, 'sourcezero.db'),
  });
  const artifacts = new LocalArtifactStore({
    rootDirectory: join(directory, 'artifacts'),
    metadata: store,
    maxArtifactBytes: 1_000_000,
  });
  const raw = await artifacts.put({
    content: new TextEncoder().encode('<html>fixture</html>'),
    mediaType: 'text/html',
    retentionClass: 'investigation',
  });
  const readableText = 'A fixture page says that a precise result increased.';
  const readable = await artifacts.put({
    content: new TextEncoder().encode(readableText),
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
  const calls: string[] = [];
  registry.register({
    name: 'provider.fetch.public_url',
    description: 'Fixture fetch.',
    inputSchema: fetchRequestSchema,
    outputSchema: fetchResponseSchema,
    timeoutMs: 1_000,
    retryPolicy: noRetries,
    budget: { perAttempt: { retrievedSources: 1 } },
    execute: () => {
      calls.push('provider.fetch.public_url');
      return Promise.resolve({
        resolvedUrl: 'https://example.test/final',
        status: 200,
        mediaType: 'text/html',
        artifactId: raw.id,
        byteLength: raw.byteLength,
        redirects: ['https://example.test/final'],
      });
    },
  });
  registry.register({
    name: 'provider.extraction.readable_text',
    description: 'Fixture extraction.',
    inputSchema: extractionRequestSchema,
    outputSchema: extractionResponseSchema,
    timeoutMs: 1_000,
    retryPolicy: noRetries,
    execute: () => {
      calls.push('provider.extraction.readable_text');
      return Promise.resolve({
        title: 'Fixture article',
        readableTextArtifactId: readable.id,
        readableCharacterCount: readableText.length,
        language: 'en',
        links: [],
        metadata: {},
      });
    },
  });
  registry.register({
    name: 'provider.model.complete',
    description: 'Fixture model.',
    inputSchema: modelRequestSchema,
    outputSchema: modelResponseSchema,
    timeoutMs: 1_000,
    retryPolicy: noRetries,
    budget: { measure: () => ({ modelTokens: 8 }) },
    execute: () => {
      calls.push('provider.model.complete');
      return Promise.resolve({
        outcome: 'completed' as const,
        providerRequestId: 'fixture-request',
        modelId: 'fixture-model',
        text: modelText,
        toolCalls: [],
        usage: { inputTokens: 4, outputTokens: 4, totalTokens: 8 },
      });
    },
  });
  const executor = new ToolExecutor({
    registry,
    recorder,
    budget: new InMemoryBudgetAccountant({
      retrievedSources: fixturePolicy.maxRetrievedSources,
      modelTokens: fixturePolicy.maxModelTokens,
      wallClockMs: fixturePolicy.maxWallClockMs,
    }),
  });
  return {
    calls,
    investigations,
    framing: new ClaimFramingService({ investigations, executor, artifacts }),
    dispose: async () => {
      registry.dispose();
      await runtime.dispose();
      store.dispose();
    },
  };
}

const noRetries = {
  maxRetries: 0,
  delayMs: 0,
  retryableFailureCodes: [],
} as const;

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
