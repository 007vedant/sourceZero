/** Adapts Brave Web Search to the provider-neutral search capability. */

import {
  searchRequestSchema,
  searchResponseSchema,
  type SearchProvider,
} from '@sourcezero/engine/harness';
import { z } from 'zod';

export const BRAVE_SEARCH_PROVIDER_ID = 'brave.web';

const braveResponseSchema = z
  .object({
    web: z
      .object({
        results: z.array(
          z
            .object({
              url: z.string(),
              title: z.string().default(''),
              description: z.string().default(''),
            })
            .loose(),
        ),
      })
      .loose()
      .optional(),
  })
  .loose();

export interface BraveSearchProviderOptions {
  readonly apiKey?: () => string | undefined;
  readonly fetch?: typeof globalThis.fetch;
}

/** Resolves credentials only while an external search is actually starting. */
export class BraveSearchProvider implements SearchProvider {
  public readonly id = BRAVE_SEARCH_PROVIDER_ID;
  readonly #apiKey: () => string | undefined;
  readonly #fetch: typeof globalThis.fetch;

  public constructor(options: BraveSearchProviderOptions = {}) {
    this.#apiKey = options.apiKey ?? (() => process.env.BRAVE_SEARCH_API_KEY);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async search(input: unknown, signal: AbortSignal): Promise<unknown> {
    const request = searchRequestSchema.parse(input);
    const apiKey = this.#apiKey()?.trim();
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error('BRAVE_SEARCH_API_KEY is required for Brave Search.');
    }
    const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
    endpoint.searchParams.set('q', request.query);
    endpoint.searchParams.set('count', Math.min(request.limit, 20).toString());
    endpoint.searchParams.set('safesearch', 'moderate');
    const response = await this.#fetch(endpoint, {
      method: 'GET',
      signal,
      headers: {
        accept: 'application/json',
        'x-subscription-token': apiKey,
      },
      redirect: 'error',
      credentials: 'omit',
    });
    if (!response.ok) {
      throw new Error(
        `Brave Search returned HTTP ${response.status.toString()}.`,
      );
    }
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > 2_000_000) {
      throw new Error('Brave Search response exceeded the byte limit.');
    }
    const body = await readBoundedText(response, 2_000_000, signal);
    const parsed = braveResponseSchema.parse(JSON.parse(body) as unknown);
    const results = (parsed.web?.results ?? []).flatMap((result) => {
      try {
        const url = new URL(result.url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
        return [
          {
            url: url.toString(),
            title: result.title,
            snippet: result.description,
          },
        ];
      } catch {
        return [];
      }
    });
    return searchResponseSchema.parse({
      results: results.slice(0, request.limit),
    });
  }
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('Brave Search response exceeded the byte limit.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const content = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(content);
}
