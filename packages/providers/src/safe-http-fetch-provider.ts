/** Retrieves bounded public resources while pinning every validated DNS hop. */

import http from 'node:http';
import https from 'node:https';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

import {
  fetchRequestSchema,
  fetchResponseSchema,
  type FetchProvider,
  type FetchResponse,
} from '@sourcezero/engine/harness';
import type { LocalArtifactStore } from '@sourcezero/engine';

import {
  NetworkPolicyError,
  PublicNetworkPolicy,
  type ResolvedAddress,
} from './network-policy.js';

export const SAFE_HTTP_FETCH_PROVIDER_ID = 'sourcezero.http';

export interface SafeHttpFetchProviderOptions {
  readonly artifacts: Pick<LocalArtifactStore, 'put'>;
  readonly networkPolicy?: PublicNetworkPolicy;
  readonly maximumRedirects?: number;
  readonly maximumResponseBytes?: number;
  readonly request?: typeof requestOnce;
}

/** Implements manual redirects, bounded streaming, and content-addressed storage. */
export class SafeHttpFetchProvider implements FetchProvider {
  public readonly id = SAFE_HTTP_FETCH_PROVIDER_ID;
  readonly #artifacts: Pick<LocalArtifactStore, 'put'>;
  readonly #networkPolicy: PublicNetworkPolicy;
  readonly #maximumRedirects: number;
  readonly #maximumResponseBytes: number;
  readonly #request: typeof requestOnce;

  public constructor(options: SafeHttpFetchProviderOptions) {
    this.#artifacts = options.artifacts;
    this.#networkPolicy = options.networkPolicy ?? new PublicNetworkPolicy();
    this.#maximumRedirects = options.maximumRedirects ?? 8;
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 5_000_000;
    this.#request = options.request ?? requestOnce;
  }

  public async fetch(input: unknown, signal: AbortSignal): Promise<unknown> {
    const request = fetchRequestSchema.parse(input);
    let current = request.url;
    const redirects: FetchResponse['redirects'] = [];
    for (;;) {
      let inspected: Awaited<ReturnType<PublicNetworkPolicy['inspect']>>;
      try {
        inspected = await this.#networkPolicy.inspect(current, signal);
      } catch (error: unknown) {
        if (!(error instanceof NetworkPolicyError)) throw error;
        return fetchResponseSchema.parse({
          outcome: 'rejected',
          code: 'blocked_destination',
          message: error.message,
          resolvedUrl: current,
          redirects,
        });
      }
      const response = await this.#request(
        inspected.url,
        inspected.addresses,
        signal,
      );
      const status = response.statusCode ?? 0;
      if (isRedirect(status)) {
        const location = response.headers.location;
        response.resume();
        if (location === undefined) {
          return rejected(
            'invalid_redirect',
            'Redirect response omitted Location.',
            current,
            redirects,
            status,
          );
        }
        let next: string;
        try {
          next = new URL(location, inspected.url).toString();
        } catch {
          return rejected(
            'invalid_redirect',
            'Redirect Location is invalid.',
            current,
            redirects,
            status,
          );
        }
        redirects.push({ from: current, to: next, status });
        if (redirects.length > this.#maximumRedirects) {
          return rejected(
            'redirect_limit',
            'Redirect limit was exceeded.',
            current,
            redirects.slice(0, this.#maximumRedirects),
          );
        }
        current = next;
        continue;
      }
      if (status < 200 || status > 299) {
        response.resume();
        return rejected(
          'http_status',
          `Destination returned HTTP ${status.toString()}.`,
          current,
          redirects,
          status,
        );
      }
      const mediaType = parseMediaType(response.headers);
      if (!allowedMediaTypes.has(mediaType)) {
        response.resume();
        return rejected(
          'unsupported_content_type',
          `Content type "${mediaType}" is not supported.`,
          current,
          redirects,
          status,
        );
      }
      const length = Number(response.headers['content-length']);
      if (Number.isFinite(length) && length > this.#maximumResponseBytes) {
        response.destroy();
        return rejected(
          'response_too_large',
          'Response exceeds the configured byte limit.',
          current,
          redirects,
          status,
        );
      }
      const content = await readBounded(
        response,
        this.#maximumResponseBytes,
        signal,
      );
      if (content === undefined) {
        return rejected(
          'response_too_large',
          'Response exceeds the configured byte limit.',
          current,
          redirects,
          status,
        );
      }
      const artifact = await this.#artifacts.put({
        content,
        mediaType,
        retentionClass: 'investigation',
        signal,
      });
      return fetchResponseSchema.parse({
        outcome: 'retrieved',
        resolvedUrl: current,
        status,
        mediaType,
        artifactId: artifact.id,
        byteLength: content.byteLength,
        redirects,
      });
    }
  }
}

const allowedMediaTypes = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
]);

function rejected(
  code: Extract<FetchResponse, { outcome: 'rejected' }>['code'],
  message: string,
  resolvedUrl: string,
  redirects: FetchResponse['redirects'],
  status?: number,
): FetchResponse {
  return fetchResponseSchema.parse({
    outcome: 'rejected',
    code,
    message,
    resolvedUrl,
    redirects,
    ...(status === undefined ? {} : { status }),
  });
}

function isRedirect(
  status: number,
): status is 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308 {
  return status >= 300 && status <= 399;
}

function parseMediaType(headers: IncomingHttpHeaders): string {
  return (
    (headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? ''
  );
}

async function readBounded(
  response: IncomingMessage,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response) {
    signal.throwIfAborted();
    const bytes =
      typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk);
    total += bytes.byteLength;
    if (total > maximumBytes) {
      response.destroy();
      return undefined;
    }
    chunks.push(bytes);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function requestOnce(
  url: URL,
  addresses: readonly ResolvedAddress[],
  signal: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    let cursor = 0;
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      url,
      {
        method: 'GET',
        signal,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'user-agent': 'SourceZero/0.0 (+local research client)',
        },
        lookup: (_hostname, _options, callback) => {
          const selected = addresses[cursor % addresses.length];
          cursor += 1;
          if (selected === undefined) {
            callback(new Error('No validated address is available.'), '', 4);
            return;
          }
          callback(null, selected.address, selected.family);
        },
      },
      resolve,
    );
    request.once('error', reject);
    request.end();
  });
}
