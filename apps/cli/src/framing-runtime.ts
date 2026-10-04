/** Assembles the durable local claim-framing runtime used by CLI commands. */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  ClaimFramingService,
  CommittedEventBus,
  DurableHarnessEventRecorder,
  InMemoryBudgetAccountant,
  InvestigationApplicationService,
  LocalArtifactStore,
  PluginRuntime,
  SqliteStore,
  ToolExecutor,
  createExtractionProviderTool,
  createFetchProviderTool,
  createModelProviderTool,
  extractionProviderRegistryKey,
  fetchProviderRegistryKey,
  foundationalProjectionsPlugin,
  modelProviderRegistryKey,
  providerRegistriesPlugin,
  type InvestigationPolicy,
  type SourceZeroConfig,
} from '@sourcezero/engine';
import {
  createOpenAIModelProviderPlugin,
  OPENAI_MODEL_PROVIDER_ID,
} from '@sourcezero/providers';

export const defaultInvestigationPolicy: InvestigationPolicy = {
  maxSearchRequests: 12,
  maxRetrievedSources: 20,
  maxTraversalDepth: 3,
  maxModelTokens: 50_000,
  maxWallClockMs: 300_000,
  perToolTimeoutMs: 20_000,
  maxRetries: 2,
  maxGraphNodes: 250,
};

export interface LocalFramingRuntime {
  readonly framing: ClaimFramingService;
  readonly investigations: InvestigationApplicationService;
  readonly modelId: string;
  readonly policy: InvestigationPolicy;
  dispose(): Promise<void>;
}

export async function openLocalFramingRuntime(
  config: SourceZeroConfig,
  dataDirectory = join(homedir(), '.sourcezero'),
): Promise<LocalFramingRuntime> {
  const model = config.providers.model;
  if (model === undefined) {
    throw new Error(
      'Claim framing requires providers.model.providerId and providers.model.modelId in SourceZero configuration.',
    );
  }
  if (model.providerId !== OPENAI_MODEL_PROVIDER_ID) {
    throw new Error(
      `Configured model provider "${model.providerId}" is not available in this CLI build.`,
    );
  }

  const root = resolve(dataDirectory);
  const store = await SqliteStore.open({
    databasePath: join(root, 'sourcezero.db'),
  });
  let runtime: PluginRuntime | undefined;
  try {
    runtime = await PluginRuntime.boot([
      providerRegistriesPlugin,
      foundationalProjectionsPlugin,
      createOpenAIModelProviderPlugin(),
    ]);
    const toolRegistry = runtime.getToolRegistry();
    const retryPolicy = {
      maxRetries: defaultInvestigationPolicy.maxRetries,
      delayMs: 250,
      retryableFailureCodes: ['provider_failure', 'timeout'] as const,
    };
    toolRegistry.register(
      createModelProviderTool(runtime.getService(modelProviderRegistryKey), {
        providerId: model.providerId,
        timeoutMs: defaultInvestigationPolicy.perToolTimeoutMs,
        retryPolicy,
      }),
    );
    toolRegistry.register(
      createFetchProviderTool(runtime.getService(fetchProviderRegistryKey), {
        ...(config.providers.fetch === undefined
          ? {}
          : { providerId: config.providers.fetch.providerId }),
        timeoutMs: defaultInvestigationPolicy.perToolTimeoutMs,
        retryPolicy,
      }),
    );
    toolRegistry.register(
      createExtractionProviderTool(
        runtime.getService(extractionProviderRegistryKey),
        {
          ...(config.providers.extraction === undefined
            ? {}
            : { providerId: config.providers.extraction.providerId }),
          timeoutMs: defaultInvestigationPolicy.perToolTimeoutMs,
          retryPolicy,
        },
      ),
    );

    const eventBus = new CommittedEventBus();
    const investigations = new InvestigationApplicationService({
      persistence: store,
      projections: runtime.getProjectionRegistry(),
      eventBus,
    });
    const recorder = new DurableHarnessEventRecorder({
      repository: store,
      onCommitted: (events) => eventBus.publish(events),
    });
    const executor = new ToolExecutor({
      registry: toolRegistry,
      recorder,
      budget: new InMemoryBudgetAccountant({
        searchRequests: defaultInvestigationPolicy.maxSearchRequests,
        retrievedSources: defaultInvestigationPolicy.maxRetrievedSources,
        modelTokens: defaultInvestigationPolicy.maxModelTokens,
        wallClockMs: defaultInvestigationPolicy.maxWallClockMs,
        graphNodes: defaultInvestigationPolicy.maxGraphNodes,
      }),
    });
    const artifacts = new LocalArtifactStore({
      rootDirectory: join(root, 'artifacts'),
      metadata: store,
      maxArtifactBytes: 15_000_000,
    });
    const activeRuntime = runtime;
    return {
      framing: new ClaimFramingService({ investigations, executor, artifacts }),
      investigations,
      modelId: model.modelId,
      policy: defaultInvestigationPolicy,
      dispose: async () => {
        await activeRuntime.dispose();
        store.dispose();
      },
    };
  } catch (error: unknown) {
    await runtime?.dispose();
    store.dispose();
    throw error;
  }
}
