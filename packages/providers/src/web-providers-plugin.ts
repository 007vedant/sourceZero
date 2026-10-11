/** Registers lifecycle-owned search, retrieval, and extraction providers. */

import {
  extractionProviderRegistryKey,
  fetchProviderRegistryKey,
  searchProviderRegistryKey,
  toDisposable,
  type LocalArtifactStore,
  type Plugin,
} from '@sourcezero/engine';

import { BraveSearchProvider } from './brave-search-provider.js';
import {
  PlaywrightBrowserRenderer,
  type BrowserRenderer,
} from './browser-renderer.js';
import { HtmlExtractionProvider } from './html-extraction-provider.js';
import { SafeHttpFetchProvider } from './safe-http-fetch-provider.js';

export interface WebProvidersPluginOptions {
  readonly artifacts: LocalArtifactStore;
  readonly browser?: BrowserRenderer;
  readonly chromiumExecutablePath?: string;
}

/** Creates concrete providers after their artifact-store owner is available. */
export function createWebProvidersPlugin(
  options: WebProvidersPluginOptions,
): Plugin {
  return {
    id: 'sourcezero.web-providers',
    requires: [
      searchProviderRegistryKey,
      fetchProviderRegistryKey,
      extractionProviderRegistryKey,
    ],
    setup(context) {
      const search = context
        .getService(searchProviderRegistryKey)
        .register(new BraveSearchProvider());
      const fetch = context
        .getService(fetchProviderRegistryKey)
        .register(new SafeHttpFetchProvider({ artifacts: options.artifacts }));
      const browser =
        options.browser ??
        (options.chromiumExecutablePath === undefined
          ? undefined
          : new PlaywrightBrowserRenderer({
              executablePath: options.chromiumExecutablePath,
            }));
      const extraction = context
        .getService(extractionProviderRegistryKey)
        .register(
          new HtmlExtractionProvider({
            artifacts: options.artifacts,
            ...(browser === undefined ? {} : { browser }),
          }),
        );
      return toDisposable(async () => {
        await extraction.dispose();
        await fetch.dispose();
        await search.dispose();
      });
    },
  };
}
