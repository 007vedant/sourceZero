/**
 * Adapts OpenAI Responses API calls to SourceZero's normalized model capability.
 */

import {
  modelRequestSchema,
  modelResponseSchema,
  modelProviderRegistryKey,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from '@sourcezero/engine/harness';
import type { Plugin } from '@sourcezero/engine/runtime';
import OpenAI from 'openai';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';
import { z } from 'zod';

export const OPENAI_MODEL_PROVIDER_ID = 'openai.responses';

export interface OpenAIResponsesClient {
  readonly responses: {
    create(
      body: ResponseCreateParamsNonStreaming,
      options?: { readonly signal?: AbortSignal },
    ): Promise<Response>;
  };
}

export interface OpenAIModelProviderOptions {
  readonly apiKey?: () => string | undefined;
  readonly client?: OpenAIResponsesClient;
  readonly clientFactory?: (apiKey: string) => OpenAIResponsesClient;
}

export function createOpenAIModelProviderPlugin(
  options: OpenAIModelProviderOptions = {},
): Plugin {
  return {
    id: 'sourcezero.provider.openai-model',
    requires: [modelProviderRegistryKey],
    setup(context) {
      return context
        .getService(modelProviderRegistryKey)
        .register(new OpenAIModelProvider(options));
    },
  };
}

/** Resolves credentials at execution time and normalizes OpenAI response items. */
export class OpenAIModelProvider implements ModelProvider {
  public readonly id = OPENAI_MODEL_PROVIDER_ID;
  readonly #apiKey: () => string | undefined;
  readonly #client: OpenAIResponsesClient | undefined;
  readonly #clientFactory: (apiKey: string) => OpenAIResponsesClient;

  public constructor(options: OpenAIModelProviderOptions = {}) {
    this.#apiKey = options.apiKey ?? (() => process.env.OPENAI_API_KEY);
    this.#client = options.client;
    this.#clientFactory =
      options.clientFactory ?? ((apiKey) => new OpenAI({ apiKey }));
  }

  public async complete(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const parsedRequest = modelRequestSchema.parse(request);
    const client = this.#client ?? this.#createAuthenticatedClient();
    let response: Response;
    try {
      response = await client.responses.create(
        {
          model: parsedRequest.modelId,
          input: parsedRequest.messages.map((message) => ({
            type: 'message' as const,
            role: message.role,
            content: message.content,
          })),
          max_output_tokens: parsedRequest.maxOutputTokens,
          parallel_tool_calls: false,
          store: false,
          tools: parsedRequest.tools.map((tool) => ({
            type: 'function' as const,
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: true,
          })),
        },
        { signal },
      );
    } catch (error: unknown) {
      if (signal.aborted) throw signal.reason;
      throw new Error('OpenAI model request failed.', { cause: error });
    }
    signal.throwIfAborted();
    return normalizeResponse(response);
  }

  #createAuthenticatedClient(): OpenAIResponsesClient {
    const apiKey = this.#apiKey()?.trim();
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error('OpenAI model provider requires OPENAI_API_KEY.');
    }
    return this.#clientFactory(apiKey);
  }
}

function normalizeResponse(response: Response): ModelResponse {
  if (response.status !== 'completed') {
    throw new Error(
      `OpenAI response ended with status "${String(response.status)}".`,
    );
  }
  if (response.usage === undefined) {
    throw new Error('OpenAI response omitted token usage.');
  }
  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.total_tokens,
  };
  const refusals = response.output.flatMap((item) =>
    item.type === 'message'
      ? item.content
          .filter((content) => content.type === 'refusal')
          .map((content) => content.refusal)
      : [],
  );
  if (refusals.length > 0) {
    return modelResponseSchema.parse({
      outcome: 'refused',
      providerRequestId: response.id,
      modelId: response.model,
      reason: refusals.join('\n'),
      usage,
    });
  }
  const toolCalls = response.output
    .filter((item) => item.type === 'function_call')
    .map((item) => ({
      callId: item.call_id,
      name: item.name,
      arguments: parseArguments(item.arguments),
    }));
  return modelResponseSchema.parse({
    outcome: 'completed',
    providerRequestId: response.id,
    modelId: response.model,
    text: response.output_text,
    toolCalls,
    usage,
  });
}

function parseArguments(value: string): z.infer<ReturnType<typeof z.json>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error: unknown) {
    throw new Error('OpenAI tool arguments were not valid JSON.', {
      cause: error,
    });
  }
  return z.json().parse(parsed);
}
