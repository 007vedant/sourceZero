/**
 * Wraps provider capabilities as centrally executed, budgeted SourceZero tools.
 */

import { Buffer } from 'node:buffer';

import type {
  ExtractionProvider,
  ExtractionRequest,
  ExtractionResponse,
  FetchProvider,
  FetchRequest,
  FetchResponse,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  SearchProvider,
  SearchRequest,
  SearchResponse,
} from './provider-contracts.js';
import {
  extractionRequestSchema,
  extractionResponseSchema,
  fetchRequestSchema,
  fetchResponseSchema,
  modelRequestSchema,
  modelResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
} from './provider-contracts.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { ToolDefinition, ToolRetryPolicy } from './tool-registry.js';

export interface ProviderToolOptions {
  readonly providerId?: string;
  readonly timeoutMs: number;
  readonly retryPolicy: ToolRetryPolicy;
}

export function createModelProviderTool(
  registry: ProviderRegistry<ModelProvider>,
  options: ProviderToolOptions,
): ToolDefinition<ModelRequest, ModelResponse> {
  return {
    name: 'provider.model.complete',
    description: 'Requests one normalized decision from the selected model.',
    inputSchema: modelRequestSchema,
    outputSchema: modelResponseSchema,
    timeoutMs: options.timeoutMs,
    retryPolicy: options.retryPolicy,
    budget: {
      estimate: (request) => ({
        modelTokens: estimateMaximumModelTokens(request),
      }),
      measure: (_request, response) => ({
        modelTokens: response.usage.totalTokens,
      }),
    },
    execute: (request, context) =>
      registry
        .resolve(options.providerId)
        .complete(request, context.signal) as Promise<ModelResponse>,
  };
}

export function createSearchProviderTool(
  registry: ProviderRegistry<SearchProvider>,
  options: ProviderToolOptions,
): ToolDefinition<SearchRequest, SearchResponse> {
  return {
    name: 'provider.search.query',
    description: 'Searches for normalized public source candidates.',
    inputSchema: searchRequestSchema,
    outputSchema: searchResponseSchema,
    timeoutMs: options.timeoutMs,
    retryPolicy: options.retryPolicy,
    budget: { perAttempt: { searchRequests: 1 } },
    execute: (request, context) =>
      registry
        .resolve(options.providerId)
        .search(request, context.signal) as Promise<SearchResponse>,
  };
}

export function createFetchProviderTool(
  registry: ProviderRegistry<FetchProvider>,
  options: ProviderToolOptions,
): ToolDefinition<FetchRequest, FetchResponse> {
  return {
    name: 'provider.fetch.public_url',
    description: 'Fetches one normalized public HTTP or HTTPS resource.',
    inputSchema: fetchRequestSchema,
    outputSchema: fetchResponseSchema,
    timeoutMs: options.timeoutMs,
    retryPolicy: options.retryPolicy,
    budget: {
      estimate: () => ({ retrievedSources: 1 }),
      measure: () => ({ retrievedSources: 1 }),
    },
    execute: (request, context) =>
      registry
        .resolve(options.providerId)
        .fetch(request, context.signal) as Promise<FetchResponse>,
  };
}

export function createExtractionProviderTool(
  registry: ProviderRegistry<ExtractionProvider>,
  options: ProviderToolOptions,
): ToolDefinition<ExtractionRequest, ExtractionResponse> {
  return {
    name: 'provider.extraction.readable_text',
    description:
      'Extracts bounded readable text and metadata from an artifact.',
    inputSchema: extractionRequestSchema,
    outputSchema: extractionResponseSchema,
    timeoutMs: options.timeoutMs,
    retryPolicy: options.retryPolicy,
    execute: (request, context) =>
      registry
        .resolve(options.providerId)
        .extract(request, context.signal) as Promise<ExtractionResponse>,
  };
}

function estimateMaximumModelTokens(request: ModelRequest): number {
  const utf8Bytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
  return utf8Bytes + request.maxOutputTokens;
}
