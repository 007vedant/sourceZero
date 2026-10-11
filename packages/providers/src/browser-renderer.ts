/** Provides a tightly bounded Playwright fallback for script-rendered public pages. */

import { chromium, type Browser } from 'playwright-core';

import { PublicNetworkPolicy } from './network-policy.js';

export interface RenderedDocument {
  readonly html: string;
  readonly resolvedUrl: string;
}

export interface BrowserRenderer {
  render(url: string, signal: AbortSignal): Promise<RenderedDocument>;
}

export interface PlaywrightBrowserRendererOptions {
  readonly executablePath: string;
  readonly networkPolicy?: PublicNetworkPolicy;
  readonly maximumRequests?: number;
  readonly maximumRenderedCharacters?: number;
  readonly navigationTimeoutMs?: number;
  readonly launch?: typeof chromium.launch;
}

/** Launches one isolated, credential-free browser context per fallback render. */
export class PlaywrightBrowserRenderer implements BrowserRenderer {
  readonly #options: Required<
    Omit<PlaywrightBrowserRendererOptions, 'networkPolicy' | 'launch'>
  >;
  readonly #networkPolicy: PublicNetworkPolicy;
  readonly #launch: typeof chromium.launch;

  public constructor(options: PlaywrightBrowserRendererOptions) {
    this.#options = {
      executablePath: options.executablePath,
      maximumRequests: options.maximumRequests ?? 40,
      maximumRenderedCharacters: options.maximumRenderedCharacters ?? 2_000_000,
      navigationTimeoutMs: options.navigationTimeoutMs ?? 15_000,
    };
    this.#networkPolicy = options.networkPolicy ?? new PublicNetworkPolicy();
    this.#launch = options.launch ?? chromium.launch.bind(chromium);
  }

  public async render(
    url: string,
    signal: AbortSignal,
  ): Promise<RenderedDocument> {
    await this.#networkPolicy.inspect(url, signal);
    let browser: Browser | undefined;
    try {
      browser = await this.#launch({
        executablePath: this.#options.executablePath,
        headless: true,
      });
      const context = await browser.newContext({
        acceptDownloads: false,
        bypassCSP: false,
        serviceWorkers: 'block',
      });
      const cancel = () => void context.close();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        let requests = 0;
        await context.route('**/*', async (route) => {
          requests += 1;
          const resourceType = route.request().resourceType();
          if (
            requests > this.#options.maximumRequests ||
            ['image', 'media', 'font', 'websocket'].includes(resourceType)
          ) {
            await route.abort('blockedbyclient');
            return;
          }
          try {
            await this.#networkPolicy.inspect(route.request().url(), signal);
            await route.continue({
              headers: sanitizedHeaders(route.request().headers()),
            });
          } catch {
            await route.abort('blockedbyclient');
          }
        });
        const page = await context.newPage();
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: this.#options.navigationTimeoutMs,
        });
        signal.throwIfAborted();
        const html = await page.content();
        if (html.length > this.#options.maximumRenderedCharacters) {
          throw new Error(
            'Rendered document exceeds the configured character limit.',
          );
        }
        return { html, resolvedUrl: page.url() };
      } finally {
        signal.removeEventListener('abort', cancel);
        await context.close();
      }
    } finally {
      await browser?.close();
    }
  }
}

function sanitizedHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const allowed = new Set([
    'accept',
    'accept-language',
    'content-type',
    'user-agent',
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => allowed.has(name.toLowerCase())),
  );
}
