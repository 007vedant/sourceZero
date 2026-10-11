/** Exercises bounded HTTP, extraction, browser fallback, and search adapters. */

import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';

import {
  ARTIFACT_FORMAT_VERSION,
  artifactIdFromHexDigest,
  type ArtifactRecord,
  type PutArtifactInput,
} from '@sourcezero/engine';
import { describe, expect, it, vi } from 'vitest';

import { BraveSearchProvider } from './brave-search-provider.js';
import type { BrowserRenderer } from './browser-renderer.js';
import { HtmlExtractionProvider } from './html-extraction-provider.js';
import { PublicNetworkPolicy } from './network-policy.js';
import { SafeHttpFetchProvider } from './safe-http-fetch-provider.js';

describe('SafeHttpFetchProvider', () => {
  it('inspects redirects and stores a bounded supported response', async () => {
    const put = vi.fn(() =>
      Promise.resolve({ id: artifactIdFromHexDigest('a'.repeat(64)) }),
    );
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        message(302, { location: 'https://next.example/page' }),
      )
      .mockResolvedValueOnce(
        message(
          200,
          { 'content-type': 'text/html; charset=utf-8' },
          '<p>ok</p>',
        ),
      );
    const provider = new SafeHttpFetchProvider({
      artifacts: { put } as never,
      networkPolicy: publicPolicy(),
      request,
    });

    await expect(
      provider.fetch(
        { operationId: 'fetch-1', url: 'https://start.example/' },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      outcome: 'retrieved',
      resolvedUrl: 'https://next.example/page',
      redirects: [
        {
          from: 'https://start.example/',
          to: 'https://next.example/page',
          status: 302,
        },
      ],
    });
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: 'text/html' }),
    );
  });

  it('rejects a redirect to a private address before the second request', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(message(302, { location: 'http://127.0.0.1/admin' }));
    const provider = new SafeHttpFetchProvider({
      artifacts: { put: vi.fn() },
      networkPolicy: publicPolicy(),
      request,
    });
    await expect(
      provider.fetch(
        { operationId: 'fetch-2', url: 'https://start.example/' },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      outcome: 'rejected',
      code: 'blocked_destination',
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('enforces content type, declared bytes, streamed bytes, and redirect count', async () => {
    const scenarios = [
      {
        response: message(200, { 'content-type': 'application/json' }, '{}'),
        code: 'unsupported_content_type',
      },
      {
        response: message(
          200,
          { 'content-type': 'text/plain', 'content-length': '99' },
          'x',
        ),
        code: 'response_too_large',
      },
      {
        response: message(200, { 'content-type': 'text/plain' }, '123456'),
        code: 'response_too_large',
      },
    ] as const;
    for (const scenario of scenarios) {
      const provider = new SafeHttpFetchProvider({
        artifacts: { put: vi.fn() },
        networkPolicy: publicPolicy(),
        maximumResponseBytes: 5,
        request: vi.fn().mockResolvedValue(scenario.response),
      });
      await expect(
        provider.fetch(
          { operationId: 'bounded-fetch', url: 'https://example.com/' },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ code: scenario.code });
    }
    const redirecting = new SafeHttpFetchProvider({
      artifacts: { put: vi.fn() },
      networkPolicy: publicPolicy(),
      maximumRedirects: 0,
      request: vi.fn().mockResolvedValue(message(301, { location: '/again' })),
    });
    await expect(
      redirecting.fetch(
        { operationId: 'redirect-limit', url: 'https://example.com/' },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ code: 'redirect_limit' });
  });

  it('passes cancellation to an active request', async () => {
    const controller = new AbortController();
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const request = vi.fn(
      (_url, _addresses, signal: AbortSignal) =>
        new Promise<IncomingMessage>((_resolve, reject) => {
          notifyStarted?.();
          signal.addEventListener(
            'abort',
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error('Request canceled.'),
              ),
            { once: true },
          );
        }),
    );
    const provider = new SafeHttpFetchProvider({
      artifacts: { put: vi.fn() },
      networkPolicy: publicPolicy(),
      request,
    });
    const pending = provider.fetch(
      { operationId: 'cancel-fetch', url: 'https://example.com/' },
      controller.signal,
    );
    await started;
    controller.abort(new Error('timed out'));
    await expect(pending).rejects.toThrow('timed out');
  });
});

describe('HtmlExtractionProvider', () => {
  it('extracts readable text, metadata, citations, links, named sources, and quoted leads', async () => {
    const stored: Uint8Array[] = [];
    const provider = new HtmlExtractionProvider({
      artifacts: {
        read: () =>
          Promise.resolve(
            new TextEncoder().encode(
              `<!doctype html><html lang="en"><head><title>Report</title><meta name="citation_author" content="Ada Example"></head><body><main><p>A readable report says “This exact phrase is long enough to investigate carefully”.</p><cite>Example Journal</cite><div class="references"><a href="/paper">Paper</a></div><a href="https://other.example/news">News</a></main></body></html>`,
            ),
          ),
        put: (input: PutArtifactInput) => {
          stored.push(input.content);
          return Promise.resolve(artifactRecord('b', 'text/plain'));
        },
      },
    });
    await expect(
      provider.extract(
        {
          operationId: 'extract-1',
          artifactId: artifactIdFromHexDigest('a'.repeat(64)),
          mediaType: 'text/html',
          documentUrl: 'https://example.com/report',
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      title: 'Report',
      language: 'en',
      extractionMethod: 'static',
      namedSources: expect.arrayContaining(['Ada Example', 'Example Journal']),
      exactPhrases: [
        'This exact phrase is long enough to investigate carefully',
      ],
      links: expect.arrayContaining([
        expect.objectContaining({
          url: 'https://example.com/paper',
          kind: 'citation',
        }),
        expect.objectContaining({
          url: 'https://other.example/news',
          kind: 'hyperlink',
        }),
      ]),
    });
    expect(new TextDecoder().decode(stored[0])).toContain('A readable report');
  });

  it('uses the browser only for inadequate scripted content and bounds decoded characters', async () => {
    const render = vi.fn(() =>
      Promise.resolve({
        resolvedUrl: 'https://example.com/app',
        html: '<html><body><main>Rendered content is now sufficiently useful for an investigation.</main></body></html>',
      }),
    );
    const browser: BrowserRenderer = { render };
    let count = 0;
    const provider = new HtmlExtractionProvider({
      browser,
      maximumDecodedCharacters: 500,
      artifacts: {
        read: () =>
          Promise.resolve(
            new TextEncoder().encode(
              '<html><body><script src="/app.js"></script></body></html>',
            ),
          ),
        put: () =>
          Promise.resolve(
            artifactRecord(
              (++count).toString(16).padStart(64, '0'),
              'text/html',
            ),
          ),
      },
    });
    await expect(
      provider.extract(
        {
          operationId: 'extract-browser',
          artifactId: artifactIdFromHexDigest('f'.repeat(64)),
          mediaType: 'text/html',
          documentUrl: 'https://example.com/app',
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      extractionMethod: 'browser',
      renderedArtifactId: expect.any(String),
    });
    expect(render).toHaveBeenCalledOnce();

    const oversized = new HtmlExtractionProvider({
      maximumDecodedCharacters: 3,
      artifacts: {
        read: () => Promise.resolve(new TextEncoder().encode('four')),
        put: vi.fn(),
      },
    });
    await expect(
      oversized.extract(
        {
          operationId: 'extract-large',
          artifactId: artifactIdFromHexDigest('e'.repeat(64)),
          mediaType: 'text/plain',
          documentUrl: 'https://example.com/',
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('character limit');
  });
});

describe('BraveSearchProvider', () => {
  it('resolves credentials at call time and normalizes only public-web result protocols', async () => {
    const apiKey = vi.fn(() => 'secret');
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  url: 'https://example.com/a',
                  title: 'A',
                  description: 'One',
                },
                { url: 'file:///etc/passwd', title: 'No', description: 'No' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const provider = new BraveSearchProvider({ apiKey, fetch });
    expect(apiKey).not.toHaveBeenCalled();
    await expect(
      provider.search(
        { operationId: 'search-1', query: 'claim', limit: 5 },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      results: [{ url: 'https://example.com/a', title: 'A', snippet: 'One' }],
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'api.search.brave.com' }),
      expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
    );
  });
});

function publicPolicy(): PublicNetworkPolicy {
  return new PublicNetworkPolicy({
    resolve: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
  });
}

function message(
  statusCode: number,
  headers: Record<string, string>,
  body = '',
): IncomingMessage {
  const stream = new PassThrough();
  Object.assign(stream, { statusCode, headers });
  stream.end(body);
  return stream as unknown as IncomingMessage;
}

function artifactRecord(hexDigit: string, mediaType: string): ArtifactRecord {
  const digest = hexDigit.length === 1 ? hexDigit.repeat(64) : hexDigit;
  return {
    id: artifactIdFromHexDigest(digest),
    algorithm: 'sha256',
    mediaType,
    byteLength: 0,
    createdAt: '2026-10-11T00:00:00.000Z',
    retentionClass: 'investigation',
    relativeLocation: `sha256/${digest.slice(0, 2)}/${digest.slice(2, 4)}/${digest}`,
    formatVersion: ARTIFACT_FORMAT_VERSION,
  };
}
