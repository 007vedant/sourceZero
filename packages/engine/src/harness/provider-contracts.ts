/**
 * Defines provider-neutral, runtime-validated capability requests and outcomes.
 */

import { z } from 'zod';

import { artifactIdSchema } from '../domain/identifiers.js';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Expected an HTTP or HTTPS URL.');

export const modelMessageSchema = z
  .object({
    role: z.enum(['developer', 'user', 'assistant']),
    content: z.string().min(1).max(1_000_000),
  })
  .strict();

export const modelToolSchema = z
  .object({
    name: identifierSchema,
    description: z.string().min(1).max(2_000),
    inputSchema: z.record(z.string(), z.json()),
  })
  .strict();

export const modelRequestSchema = z
  .object({
    operationId: identifierSchema,
    modelId: identifierSchema,
    maxOutputTokens: z.number().int().positive().max(1_000_000),
    messages: z.array(modelMessageSchema).min(1).max(1_000),
    tools: z.array(modelToolSchema).max(200).default([]),
  })
  .strict();

const modelUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (usage) => usage.totalTokens === usage.inputTokens + usage.outputTokens,
    'Total tokens must equal input plus output tokens.',
  );

const modelToolCallSchema = z
  .object({
    callId: identifierSchema,
    name: identifierSchema,
    arguments: z.json(),
  })
  .strict();

export const modelResponseSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('completed'),
      providerRequestId: identifierSchema,
      modelId: identifierSchema,
      text: z.string().max(1_000_000),
      toolCalls: z.array(modelToolCallSchema).max(200),
      usage: modelUsageSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal('refused'),
      providerRequestId: identifierSchema,
      modelId: identifierSchema,
      reason: z.string().min(1).max(2_000),
      usage: modelUsageSchema,
    })
    .strict(),
]);

export type ModelRequest = z.infer<typeof modelRequestSchema>;
export type ModelResponse = z.infer<typeof modelResponseSchema>;

export interface ModelProvider {
  readonly id: string;
  complete(request: ModelRequest, signal: AbortSignal): Promise<unknown>;
}

export const searchRequestSchema = z
  .object({
    operationId: identifierSchema,
    query: z.string().trim().min(1).max(2_000),
    limit: z.number().int().positive().max(100),
  })
  .strict();

export const searchResponseSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            url: httpUrlSchema,
            title: z.string().max(2_000),
            snippet: z.string().max(10_000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export interface SearchProvider {
  readonly id: string;
  search(request: SearchRequest, signal: AbortSignal): Promise<unknown>;
}

export const fetchRequestSchema = z
  .object({ operationId: identifierSchema, url: httpUrlSchema })
  .strict();

export const fetchResponseSchema = z
  .object({
    resolvedUrl: httpUrlSchema,
    status: z.number().int().min(100).max(599),
    mediaType: z.string().min(1).max(200),
    artifactId: artifactIdSchema,
    byteLength: z.number().int().nonnegative().max(15_000_000),
    redirects: z.array(httpUrlSchema).max(20),
  })
  .strict();

export type FetchRequest = z.infer<typeof fetchRequestSchema>;
export type FetchResponse = z.infer<typeof fetchResponseSchema>;

export interface FetchProvider {
  readonly id: string;
  fetch(request: FetchRequest, signal: AbortSignal): Promise<unknown>;
}

export const extractionRequestSchema = z
  .object({
    operationId: identifierSchema,
    artifactId: artifactIdSchema,
    mediaType: z.string().min(1).max(200),
  })
  .strict();

export const extractionResponseSchema = z
  .object({
    title: z.string().max(2_000).optional(),
    readableTextArtifactId: artifactIdSchema,
    readableCharacterCount: z.number().int().nonnegative().max(5_000_000),
    language: z.string().min(1).max(50).optional(),
    links: z.array(httpUrlSchema).max(10_000),
    metadata: z.record(z.string(), z.string().max(10_000)),
  })
  .strict();

export type ExtractionRequest = z.infer<typeof extractionRequestSchema>;
export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;

export interface ExtractionProvider {
  readonly id: string;
  extract(request: ExtractionRequest, signal: AbortSignal): Promise<unknown>;
}
