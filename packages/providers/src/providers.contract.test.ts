/** Runs provider contracts against fixture, replay, and hosted-model adapters. */

import {
  artifactIdFromHexDigest,
  extractionResponseSchema,
  fetchResponseSchema,
  modelResponseSchema,
  modelProviderRegistryKey,
  providerRegistriesPlugin,
  searchResponseSchema,
  type ExtractionRequest,
  type ExtractionResponse,
  type FetchRequest,
  type FetchResponse,
  type ModelRequest,
  type ModelResponse,
  type SearchRequest,
  type SearchResponse,
} from '@sourcezero/engine';
import { PluginRuntime } from '@sourcezero/engine/runtime';
import type { Response } from 'openai/resources/responses/responses';
import { describe, expect, it, vi } from 'vitest';

import {
  FixtureExtractionProvider,
  FixtureFetchProvider,
  FixtureModelProvider,
  FixtureSearchProvider,
  ReplayExtractionProvider,
  ReplayFetchProvider,
  ReplayModelProvider,
  ReplaySearchProvider,
} from './deterministic-providers.js';
import {
  createOpenAIModelProviderPlugin,
  OpenAIModelProvider,
  type OpenAIResponsesClient,
} from './openai-model-provider.js';

const modelRequest: ModelRequest = {
  operationId: 'model-operation-1',
  modelId: 'gpt-6-astra',
  maxOutputTokens: 1_000,
  messages: [{ role: 'user', content: 'Investigate the claim.' }],
  tools: [
    {
      name: 'search_web',
      description: 'Searches public web candidates.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  ],
};

const modelResponse: ModelResponse = {
  outcome: 'completed',
  providerRequestId: 'response-fixture-1',
  modelId: 'fixture-model',
  text: '',
  toolCalls: [
    { callId: 'call-fixture-1', name: 'search_web', arguments: { query: 'x' } },
  ],
  usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
};

const searchRequest: SearchRequest = {
  operationId: 'search-operation-1',
  query: 'claim origin',
  limit: 5,
};
const searchResponse: SearchResponse = {
  results: [
    { url: 'https://example.com/source', title: 'Source', snippet: 'Result' },
  ],
};
const fetchRequest: FetchRequest = {
  operationId: 'fetch-operation-1',
  url: 'https://example.com/source',
};
const fetchResponse: FetchResponse = {
  resolvedUrl: 'https://example.com/source',
  status: 200,
  mediaType: 'text/html',
  artifactId: artifactIdFromHexDigest('b'.repeat(64)),
  byteLength: 5,
  redirects: [],
};
const extractionRequest: ExtractionRequest = {
  operationId: 'extract-operation-1',
  artifactId: artifactIdFromHexDigest('a'.repeat(64)),
  mediaType: 'text/html',
};
const extractionResponse: ExtractionResponse = {
  title: 'Fixture',
  readableTextArtifactId: artifactIdFromHexDigest('c'.repeat(64)),
  readableCharacterCount: 5,
  links: [],
  metadata: {},
};

describe('fixture and replay provider contracts', () => {
  it('validates every fixture capability implementation', async () => {
    const signal = new AbortController().signal;
    const model = new FixtureModelProvider(
      'fixture.model',
      () => modelResponse,
    );
    const search = new FixtureSearchProvider(
      'fixture.search',
      () => searchResponse,
    );
    const fetch = new FixtureFetchProvider(
      'fixture.fetch',
      () => fetchResponse,
    );
    const extraction = new FixtureExtractionProvider(
      'fixture.extraction',
      () => extractionResponse,
    );

    expect(
      modelResponseSchema.parse(await model.complete(modelRequest, signal)),
    ).toEqual(modelResponse);
    expect(
      searchResponseSchema.parse(await search.search(searchRequest, signal)),
    ).toEqual(searchResponse);
    expect(
      fetchResponseSchema.parse(await fetch.fetch(fetchRequest, signal)),
    ).toEqual(fetchResponse);
    expect(
      extractionResponseSchema.parse(
        await extraction.extract(extractionRequest, signal),
      ),
    ).toEqual(extractionResponse);
  });

  it('replays every capability without a delegate or external call', async () => {
    const signal = new AbortController().signal;
    const model = new ReplayModelProvider('replay.model', [
      { request: modelRequest, response: modelResponse },
    ]);
    const search = new ReplaySearchProvider('replay.search', [
      { request: searchRequest, response: searchResponse },
    ]);
    const fetch = new ReplayFetchProvider('replay.fetch', [
      { request: fetchRequest, response: fetchResponse },
    ]);
    const extraction = new ReplayExtractionProvider('replay.extraction', [
      { request: extractionRequest, response: extractionResponse },
    ]);

    await expect(model.complete(modelRequest, signal)).resolves.toEqual(
      modelResponse,
    );
    await expect(search.search(searchRequest, signal)).resolves.toEqual(
      searchResponse,
    );
    await expect(fetch.fetch(fetchRequest, signal)).resolves.toEqual(
      fetchResponse,
    );
    await expect(
      extraction.extract(extractionRequest, signal),
    ).resolves.toEqual(extractionResponse);
  });

  it('rejects replay divergence and observes cancellation', async () => {
    const replay = new ReplaySearchProvider('replay.search', [
      { request: searchRequest, response: searchResponse },
    ]);
    await expect(
      replay.search(
        { ...searchRequest, query: 'different' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('does not match');
    const controller = new AbortController();
    controller.abort();
    await expect(
      replay.search(searchRequest, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('OpenAIModelProvider contract', () => {
  it('registers through a lifecycle-owned provider plugin', async () => {
    const runtime = await PluginRuntime.boot([
      providerRegistriesPlugin,
      createOpenAIModelProviderPlugin({
        client: {
          responses: { create: () => Promise.resolve(openAIResponse()) },
        },
      }),
    ]);

    expect(runtime.getService(modelProviderRegistryKey).resolve().id).toBe(
      'openai.responses',
    );
    await runtime.dispose();
  });

  it('maps strict Responses API function calls to normalized output', async () => {
    const create = vi.fn(() => Promise.resolve(openAIResponse()));
    const client: OpenAIResponsesClient = { responses: { create } };
    const provider = new OpenAIModelProvider({ client });
    const signal = new AbortController().signal;

    const response = modelResponseSchema.parse(
      await provider.complete(modelRequest, signal),
    );

    expect(response).toMatchObject({
      outcome: 'completed',
      providerRequestId: 'resp_fixture_1',
      modelId: 'gpt-6-astra',
      toolCalls: [
        {
          callId: 'call_fixture_1',
          name: 'search_web',
          arguments: { query: 'x' },
        },
      ],
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-6-astra',
        max_output_tokens: 1_000,
        parallel_tool_calls: false,
        store: false,
        tools: [expect.objectContaining({ name: 'search_web', strict: true })],
      }),
      { signal },
    );
  });

  it('resolves credentials only when a real call begins', async () => {
    const apiKey = vi.fn(() => 'test-key');
    const create = vi.fn(() => Promise.resolve(openAIResponse()));
    const clientFactory = vi.fn((): OpenAIResponsesClient => ({
      responses: { create },
    }));
    const provider = new OpenAIModelProvider({ apiKey, clientFactory });
    expect(apiKey).not.toHaveBeenCalled();

    await provider.complete(modelRequest, new AbortController().signal);

    expect(apiKey).toHaveBeenCalledOnce();
    expect(clientFactory).toHaveBeenCalledWith('test-key');
  });

  it('passes cancellation to an active OpenAI request', async () => {
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const provider = new OpenAIModelProvider({
      client: {
        responses: {
          create: (_body, options) =>
            new Promise((resolve, reject) => {
              notifyStarted?.();
              options?.signal?.addEventListener(
                'abort',
                () => reject(new Error('request aborted')),
                { once: true },
              );
            }),
        },
      },
    });
    const controller = new AbortController();
    const pending = provider.complete(modelRequest, controller.signal);
    await started;
    controller.abort(new Error('user canceled'));

    await expect(pending).rejects.toThrow('user canceled');
  });

  it('normalizes refusals and rejects malformed tool arguments', async () => {
    const refusalProvider = new OpenAIModelProvider({
      client: {
        responses: {
          create: () =>
            Promise.resolve(
              openAIResponse({
                output: [
                  {
                    id: 'message_1',
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'refusal', refusal: 'Cannot assist.' }],
                  },
                ],
              }),
            ),
        },
      },
    });
    await expect(
      refusalProvider.complete(modelRequest, new AbortController().signal),
    ).resolves.toMatchObject({ outcome: 'refused', reason: 'Cannot assist.' });

    const malformed = new OpenAIModelProvider({
      client: {
        responses: {
          create: () =>
            Promise.resolve(
              openAIResponse({
                output: [
                  {
                    type: 'function_call',
                    call_id: 'call_fixture_1',
                    name: 'search_web',
                    arguments: '{not-json',
                  },
                ],
              }),
            ),
        },
      },
    });
    await expect(
      malformed.complete(modelRequest, new AbortController().signal),
    ).rejects.toThrow('not valid JSON');
  });
});

function openAIResponse(overrides: Partial<Response> = {}): Response {
  return {
    id: 'resp_fixture_1',
    object: 'response',
    created_at: 0,
    status: 'completed',
    model: 'gpt-6-astra',
    output_text: '',
    output: [
      {
        type: 'function_call',
        call_id: 'call_fixture_1',
        name: 'search_web',
        arguments: '{"query":"x"}',
      },
    ],
    usage: {
      input_tokens: 5,
      output_tokens: 3,
      total_tokens: 8,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    ...overrides,
  } as unknown as Response;
}
