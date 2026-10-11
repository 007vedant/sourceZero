/** Extracts bounded readable content and discovery leads from immutable page artifacts. */

import { load, type CheerioAPI } from 'cheerio';
import {
  extractionRequestSchema,
  extractionResponseSchema,
  type ExtractionProvider,
} from '@sourcezero/engine/harness';
import type { ArtifactId, LocalArtifactStore } from '@sourcezero/engine';

import type { BrowserRenderer } from './browser-renderer.js';

export const HTML_EXTRACTION_PROVIDER_ID = 'sourcezero.html';

export interface HtmlExtractionProviderOptions {
  readonly artifacts: Pick<LocalArtifactStore, 'read' | 'put'>;
  readonly browser?: BrowserRenderer;
  readonly maximumDecodedCharacters?: number;
  readonly maximumLinks?: number;
  readonly minimumStaticCharacters?: number;
}

/** Keeps untrusted markup as data and stores every model-visible derived text. */
export class HtmlExtractionProvider implements ExtractionProvider {
  public readonly id = HTML_EXTRACTION_PROVIDER_ID;
  readonly #artifacts: Pick<LocalArtifactStore, 'read' | 'put'>;
  readonly #browser: BrowserRenderer | undefined;
  readonly #maximumDecodedCharacters: number;
  readonly #maximumLinks: number;
  readonly #minimumStaticCharacters: number;

  public constructor(options: HtmlExtractionProviderOptions) {
    this.#artifacts = options.artifacts;
    this.#browser = options.browser;
    this.#maximumDecodedCharacters =
      options.maximumDecodedCharacters ?? 1_000_000;
    this.#maximumLinks = options.maximumLinks ?? 2_000;
    this.#minimumStaticCharacters = options.minimumStaticCharacters ?? 200;
  }

  public async extract(input: unknown, signal: AbortSignal): Promise<unknown> {
    const request = extractionRequestSchema.parse(input);
    const bytes = await this.#artifacts.read(request.artifactId, signal);
    let html = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (html.length > this.#maximumDecodedCharacters) {
      throw new Error(
        'Decoded document exceeds the configured character limit.',
      );
    }
    let documentUrl = request.documentUrl;
    let method: 'static' | 'browser' = 'static';
    let renderedArtifactId: ArtifactId | undefined;
    let extracted = extractDocument(html, documentUrl, this.#maximumLinks);
    if (
      this.#browser !== undefined &&
      extracted.text.length < this.#minimumStaticCharacters &&
      /<script\b[^>]*\bsrc\s*=/iu.test(html)
    ) {
      const rendered = await this.#browser.render(documentUrl, signal);
      html = rendered.html;
      documentUrl = rendered.resolvedUrl;
      const artifact = await this.#artifacts.put({
        content: new TextEncoder().encode(html),
        mediaType: 'text/html',
        retentionClass: 'investigation',
        signal,
      });
      renderedArtifactId = artifact.id;
      method = 'browser';
      extracted = extractDocument(html, documentUrl, this.#maximumLinks);
    }
    if (extracted.text.length > this.#maximumDecodedCharacters) {
      throw new Error(
        'Readable document exceeds the configured character limit.',
      );
    }
    const readable = await this.#artifacts.put({
      content: new TextEncoder().encode(extracted.text),
      mediaType: 'text/plain',
      retentionClass: 'investigation',
      signal,
    });
    return extractionResponseSchema.parse({
      ...(extracted.title === undefined ? {} : { title: extracted.title }),
      readableTextArtifactId: readable.id,
      readableCharacterCount: extracted.text.length,
      ...(extracted.language === undefined
        ? {}
        : { language: extracted.language }),
      links: extracted.links,
      namedSources: extracted.namedSources,
      exactPhrases: extracted.exactPhrases,
      metadata: extracted.metadata,
      extractionMethod: method,
      ...(renderedArtifactId === undefined ? {} : { renderedArtifactId }),
    });
  }
}

function extractDocument(
  html: string,
  documentUrl: string,
  maximumLinks: number,
) {
  const $ = load(html);
  const title = boundedText($('title').first().text(), 2_000);
  const language = boundedText($('html').attr('lang') ?? '', 50);
  const metadata = collectMetadata($);
  const namedSources = unique([
    ...$('cite')
      .toArray()
      .map((element) => boundedText($(element).text(), 2_000)),
    ...Object.entries(metadata)
      .filter(([key]) =>
        /^(citation_(author|publication_title)|author)$/iu.test(key),
      )
      .map(([, value]) => value),
  ])
    .filter(nonEmpty)
    .slice(0, 1_000);
  const links = $('a[href]')
    .toArray()
    .flatMap((element) => {
      const href = $(element).attr('href');
      if (href === undefined) return [];
      try {
        const url = new URL(href, documentUrl);
        url.hash = '';
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
        const inCitation =
          $(element).closest(
            'cite, [role="doc-bibliography"], .references, #references',
          ).length > 0;
        return [
          {
            url: url.toString(),
            text: boundedText($(element).text(), 2_000),
            kind: inCitation ? ('citation' as const) : ('hyperlink' as const),
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, maximumLinks);
  $('script, style, noscript, template, svg, nav, form').remove();
  const root =
    $('article').first().length > 0
      ? $('article').first()
      : $('main').first().length > 0
        ? $('main').first()
        : $('body');
  const text = normalizeWhitespace(root.text());
  const exactPhrases = unique(
    [...text.matchAll(/[“"]([^”"\n]{20,500})[”"]/gu)].map((match) =>
      normalizeWhitespace(match[1] ?? ''),
    ),
  )
    .filter(nonEmpty)
    .slice(0, 1_000);
  return {
    ...(title.length === 0 ? {} : { title }),
    ...(language.length === 0 ? {} : { language }),
    text,
    links,
    namedSources,
    exactPhrases,
    metadata,
  };
}

function collectMetadata($: CheerioAPI): Record<string, string> {
  const entries: [string, string][] = [];
  $('meta[name][content], meta[property][content]').each((_index, element) => {
    if (entries.length >= 200) return;
    const key = ($(element).attr('name') ?? $(element).attr('property') ?? '')
      .trim()
      .toLowerCase();
    const value = boundedText($(element).attr('content') ?? '', 10_000);
    if (key.length > 0 && key.length <= 200 && value.length > 0)
      entries.push([key, value]);
  });
  return Object.fromEntries(entries);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function boundedText(value: string, maximum: number): string {
  return normalizeWhitespace(value).slice(0, maximum);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function nonEmpty(value: string): boolean {
  return value.length > 0;
}
