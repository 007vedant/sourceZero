/**
 * Supplies validated fixture and replay implementations for every provider seam.
 */

import {
  extractionRequestSchema,
  extractionResponseSchema,
  fetchRequestSchema,
  fetchResponseSchema,
  modelRequestSchema,
  modelResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResponse,
  type FetchProvider,
  type FetchRequest,
  type FetchResponse,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type SearchProvider,
  type SearchRequest,
  type SearchResponse,
} from '@sourcezero/engine/harness';
import type { z } from 'zod';

export type FixtureHandler<Request, Response> = (
  request: Request,
  signal: AbortSignal,
) => Response | Promise<Response>;

export interface ProviderRecording<Request, Response> {
  readonly request: Request;
  readonly response: Response;
}

/** Runs a deterministic model handler through the production schemas. */
export class FixtureModelProvider implements ModelProvider {
  public readonly id: string;
  readonly #handler: FixtureHandler<ModelRequest, ModelResponse>;

  public constructor(
    id: string,
    handler: FixtureHandler<ModelRequest, ModelResponse>,
  ) {
    this.id = providerId(id);
    this.#handler = handler;
  }

  public async complete(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    return invokeFixture(
      modelRequestSchema,
      modelResponseSchema,
      this.#handler,
      request,
      signal,
    );
  }
}

/** Replays exact recorded model requests without invoking a model. */
export class ReplayModelProvider implements ModelProvider {
  public readonly id: string;
  readonly #replay: ReplaySequence<ModelRequest, ModelResponse>;

  public constructor(
    id: string,
    recordings: readonly ProviderRecording<ModelRequest, ModelResponse>[],
  ) {
    this.id = providerId(id);
    this.#replay = new ReplaySequence(
      modelRequestSchema,
      modelResponseSchema,
      recordings,
    );
  }

  public complete(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.#replay.next(request, signal);
  }
}

/** Runs a deterministic search handler through the production schemas. */
export class FixtureSearchProvider implements SearchProvider {
  public readonly id: string;
  readonly #handler: FixtureHandler<SearchRequest, SearchResponse>;

  public constructor(
    id: string,
    handler: FixtureHandler<SearchRequest, SearchResponse>,
  ) {
    this.id = providerId(id);
    this.#handler = handler;
  }

  public async search(
    request: SearchRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    return invokeFixture(
      searchRequestSchema,
      searchResponseSchema,
      this.#handler,
      request,
      signal,
    );
  }
}

/** Replays exact recorded search requests without external calls. */
export class ReplaySearchProvider implements SearchProvider {
  public readonly id: string;
  readonly #replay: ReplaySequence<SearchRequest, SearchResponse>;

  public constructor(
    id: string,
    recordings: readonly ProviderRecording<SearchRequest, SearchResponse>[],
  ) {
    this.id = providerId(id);
    this.#replay = new ReplaySequence(
      searchRequestSchema,
      searchResponseSchema,
      recordings,
    );
  }

  public search(request: SearchRequest, signal: AbortSignal): Promise<unknown> {
    return this.#replay.next(request, signal);
  }
}

/** Runs a deterministic fetch handler through the production schemas. */
export class FixtureFetchProvider implements FetchProvider {
  public readonly id: string;
  readonly #handler: FixtureHandler<FetchRequest, FetchResponse>;

  public constructor(
    id: string,
    handler: FixtureHandler<FetchRequest, FetchResponse>,
  ) {
    this.id = providerId(id);
    this.#handler = handler;
  }

  public async fetch(
    request: FetchRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    return invokeFixture(
      fetchRequestSchema,
      fetchResponseSchema,
      this.#handler,
      request,
      signal,
    );
  }
}

/** Replays exact recorded fetch requests without network calls. */
export class ReplayFetchProvider implements FetchProvider {
  public readonly id: string;
  readonly #replay: ReplaySequence<FetchRequest, FetchResponse>;

  public constructor(
    id: string,
    recordings: readonly ProviderRecording<FetchRequest, FetchResponse>[],
  ) {
    this.id = providerId(id);
    this.#replay = new ReplaySequence(
      fetchRequestSchema,
      fetchResponseSchema,
      recordings,
    );
  }

  public fetch(request: FetchRequest, signal: AbortSignal): Promise<unknown> {
    return this.#replay.next(request, signal);
  }
}

/** Runs a deterministic extraction handler through the production schemas. */
export class FixtureExtractionProvider implements ExtractionProvider {
  public readonly id: string;
  readonly #handler: FixtureHandler<ExtractionRequest, ExtractionResponse>;

  public constructor(
    id: string,
    handler: FixtureHandler<ExtractionRequest, ExtractionResponse>,
  ) {
    this.id = providerId(id);
    this.#handler = handler;
  }

  public async extract(
    request: ExtractionRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    return invokeFixture(
      extractionRequestSchema,
      extractionResponseSchema,
      this.#handler,
      request,
      signal,
    );
  }
}

/** Replays exact recorded extraction requests without parser calls. */
export class ReplayExtractionProvider implements ExtractionProvider {
  public readonly id: string;
  readonly #replay: ReplaySequence<ExtractionRequest, ExtractionResponse>;

  public constructor(
    id: string,
    recordings: readonly ProviderRecording<
      ExtractionRequest,
      ExtractionResponse
    >[],
  ) {
    this.id = providerId(id);
    this.#replay = new ReplaySequence(
      extractionRequestSchema,
      extractionResponseSchema,
      recordings,
    );
  }

  public extract(
    request: ExtractionRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.#replay.next(request, signal);
  }
}

/** Owns ordered replay consumption and exact request matching. */
class ReplaySequence<Request, Response> {
  readonly #requestSchema: z.ZodType<Request>;
  readonly #responseSchema: z.ZodType<Response>;
  readonly #recordings: readonly ProviderRecording<Request, Response>[];
  #cursor = 0;

  public constructor(
    requestSchema: z.ZodType<Request>,
    responseSchema: z.ZodType<Response>,
    recordings: readonly ProviderRecording<Request, Response>[],
  ) {
    this.#requestSchema = requestSchema;
    this.#responseSchema = responseSchema;
    this.#recordings = recordings.map((recording) => ({
      request: requestSchema.parse(recording.request),
      response: responseSchema.parse(recording.response),
    }));
  }

  public next(request: Request, signal: AbortSignal): Promise<Response> {
    return Promise.resolve().then(() => {
      signal.throwIfAborted();
      const parsedRequest = this.#requestSchema.parse(request);
      const recording = this.#recordings[this.#cursor];
      if (recording === undefined) {
        throw new Error('Replay provider has no remaining recording.');
      }
      if (stableJson(parsedRequest) !== stableJson(recording.request)) {
        throw new Error(
          'Replay provider request does not match the recording.',
        );
      }
      this.#cursor += 1;
      return this.#responseSchema.parse(structuredClone(recording.response));
    });
  }
}

async function invokeFixture<Request, Response>(
  requestSchema: z.ZodType<Request>,
  responseSchema: z.ZodType<Response>,
  handler: FixtureHandler<Request, Response>,
  request: Request,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  const response = await handler(requestSchema.parse(request), signal);
  signal.throwIfAborted();
  return responseSchema.parse(response);
}

function providerId(value: string): string {
  const id = value.trim();
  if (id.length === 0) throw new TypeError('Provider ID must not be empty.');
  return id;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
