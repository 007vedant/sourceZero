/**
 * Resolves explicitly selected capability providers without order-dependent defaults.
 */

import type { Disposable } from '../runtime/disposable.js';
import { toDisposable } from '../runtime/disposable.js';
import type { Plugin } from '../runtime/plugin-runtime.js';
import { createServiceKey } from '../runtime/service-key.js';
import type {
  ExtractionProvider,
  FetchProvider,
  ModelProvider,
  SearchProvider,
} from './provider-contracts.js';

export type ProviderResolutionErrorCode =
  | 'duplicate_provider_id'
  | 'provider_unavailable'
  | 'ambiguous_provider_selection';

/** Reports deterministic provider registration and selection failures. */
export class ProviderResolutionError extends Error {
  public constructor(
    public readonly code: ProviderResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderResolutionError';
  }
}

export interface IdentifiedProvider {
  readonly id: string;
}

/** Owns provider registrations for one capability and resolves one usable provider. */
export class ProviderRegistry<
  Provider extends IdentifiedProvider,
> implements Disposable {
  readonly #capability: string;
  readonly #providers = new Map<string, Provider>();
  #disposed = false;

  public constructor(capability: string) {
    const normalized = capability.trim();
    if (normalized.length === 0) {
      throw new TypeError('Provider capability must not be empty.');
    }
    this.#capability = normalized;
  }

  public register(provider: Provider): Disposable {
    this.#assertActive();
    const id = provider.id.trim();
    if (id.length === 0) {
      throw new TypeError('Provider ID must not be empty.');
    }
    if (this.#providers.has(id)) {
      throw new ProviderResolutionError(
        'duplicate_provider_id',
        `${this.#capability} provider "${id}" is already registered.`,
      );
    }
    this.#providers.set(id, provider);
    return toDisposable(() => {
      if (this.#providers.get(id) === provider) this.#providers.delete(id);
    });
  }

  public resolve(configuredId?: string): Provider {
    this.#assertActive();
    if (configuredId !== undefined) {
      const provider = this.#providers.get(configuredId);
      if (provider === undefined) {
        throw new ProviderResolutionError(
          'provider_unavailable',
          `Configured ${this.#capability} provider "${configuredId}" is not registered.`,
        );
      }
      return provider;
    }
    if (this.#providers.size === 1) {
      const provider = this.#providers.values().next().value;
      if (provider !== undefined) return provider;
    }
    if (this.#providers.size === 0) {
      throw new ProviderResolutionError(
        'provider_unavailable',
        `No ${this.#capability} provider is registered.`,
      );
    }
    throw new ProviderResolutionError(
      'ambiguous_provider_selection',
      `Multiple ${this.#capability} providers are registered; configure one explicitly.`,
    );
  }

  public listIds(): readonly string[] {
    this.#assertActive();
    return [...this.#providers.keys()].sort();
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#providers.clear();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Provider registry is disposed.');
  }
}

export const modelProviderRegistryKey = createServiceKey<
  ProviderRegistry<ModelProvider>
>('sourcezero.providers.model');
export const searchProviderRegistryKey = createServiceKey<
  ProviderRegistry<SearchProvider>
>('sourcezero.providers.search');
export const fetchProviderRegistryKey = createServiceKey<
  ProviderRegistry<FetchProvider>
>('sourcezero.providers.fetch');
export const extractionProviderRegistryKey = createServiceKey<
  ProviderRegistry<ExtractionProvider>
>('sourcezero.providers.extraction');

export const providerRegistriesPlugin: Plugin = {
  id: 'sourcezero.provider-registries',
  provides: [
    modelProviderRegistryKey,
    searchProviderRegistryKey,
    fetchProviderRegistryKey,
    extractionProviderRegistryKey,
  ],
  setup(context) {
    const model = new ProviderRegistry<ModelProvider>('model');
    const search = new ProviderRegistry<SearchProvider>('search');
    const fetch = new ProviderRegistry<FetchProvider>('fetch');
    const extraction = new ProviderRegistry<ExtractionProvider>('extraction');
    context.registerService(modelProviderRegistryKey, model);
    context.registerService(searchProviderRegistryKey, search);
    context.registerService(fetchProviderRegistryKey, fetch);
    context.registerService(extractionProviderRegistryKey, extraction);
    return toDisposable(() => {
      extraction.dispose();
      fetch.dispose();
      search.dispose();
      model.dispose();
    });
  },
};
