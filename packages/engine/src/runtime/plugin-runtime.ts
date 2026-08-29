import type { Disposable } from './disposable.js';
import type { ProjectionDefinition } from '../domain/projection.js';
import { RuntimeError } from './errors.js';
import { ProjectionRegistry } from './projection-registry.js';
import type { ServiceKey } from './service-key.js';
import { ServiceRegistry } from './service-registry.js';

export interface PluginContext {
  registerService<T>(key: ServiceKey<T>, service: T): Disposable;
  registerProjection<State, View>(
    projection: ProjectionDefinition<State, View>,
  ): Disposable;
  getService<T>(key: ServiceKey<T>): T;
}

export interface Plugin {
  readonly id: string;
  readonly requires?: readonly ServiceKey<unknown>[];
  readonly provides?: readonly ServiceKey<unknown>[];
  setup(context: PluginContext): void | Disposable | Promise<void | Disposable>;
}

interface StartedPlugin {
  readonly id: string;
  readonly disposables: readonly Disposable[];
}

export class PluginRuntime implements Disposable {
  readonly #registry: ServiceRegistry;
  readonly #projections: ProjectionRegistry;
  readonly #startedPlugins: readonly StartedPlugin[];
  #disposed = false;

  private constructor(
    registry: ServiceRegistry,
    projections: ProjectionRegistry,
    startedPlugins: readonly StartedPlugin[],
  ) {
    this.#registry = registry;
    this.#projections = projections;
    this.#startedPlugins = startedPlugins;
  }

  public static async boot(plugins: readonly Plugin[]): Promise<PluginRuntime> {
    const orderedPlugins = orderPlugins(plugins);
    const registry = new ServiceRegistry();
    const projections = new ProjectionRegistry();
    const startedPlugins: StartedPlugin[] = [];

    try {
      for (const plugin of orderedPlugins) {
        const pluginDisposables: Disposable[] = [];
        const declaredServiceIds = new Set(
          (plugin.provides ?? []).map((key) => key.id),
        );
        const context: PluginContext = {
          getService: <T>(key: ServiceKey<T>): T => registry.get(key),
          registerProjection: <State, View>(
            projection: ProjectionDefinition<State, View>,
          ): Disposable => {
            const disposable = projections.register(plugin.id, projection);
            pluginDisposables.push(disposable);
            return disposable;
          },
          registerService: <T>(key: ServiceKey<T>, service: T): Disposable => {
            if (!declaredServiceIds.has(key.id)) {
              throw new RuntimeError(
                'undeclared_service_registration',
                `Plugin "${plugin.id}" attempted to register undeclared service "${key.id}". Add it to the plugin's provides declaration.`,
              );
            }

            const disposable = registry.register(plugin.id, key, service);
            pluginDisposables.push(disposable);
            return disposable;
          },
        };

        try {
          const pluginDisposable = await plugin.setup(context);
          if (pluginDisposable !== undefined) {
            pluginDisposables.push(pluginDisposable);
          }
          for (const key of plugin.provides ?? []) {
            if (!registry.has(key)) {
              throw new RuntimeError(
                'service_not_registered',
                `Plugin "${plugin.id}" declared service "${key.id}" but did not register it during setup.`,
              );
            }
          }

          startedPlugins.push({
            id: plugin.id,
            disposables: pluginDisposables,
          });
        } catch (error: unknown) {
          await disposeAll(pluginDisposables, plugin.id);
          if (error instanceof RuntimeError) {
            throw error;
          }

          throw new RuntimeError(
            'plugin_setup_failed',
            `Plugin "${plugin.id}" failed during setup.`,
            { cause: error },
          );
        }
      }

      return new PluginRuntime(registry, projections, startedPlugins);
    } catch (error: unknown) {
      try {
        await disposeStartedPlugins(startedPlugins);
      } finally {
        registry.dispose();
        projections.dispose();
      }
      throw error;
    }
  }

  public getService<T>(key: ServiceKey<T>): T {
    if (this.#disposed) {
      throw new RuntimeError(
        'runtime_disposed',
        'The plugin runtime is disposed.',
      );
    }

    return this.#registry.get(key);
  }

  public getProjectionRegistry(): ProjectionRegistry {
    if (this.#disposed) {
      throw new RuntimeError(
        'runtime_disposed',
        'The plugin runtime is disposed.',
      );
    }
    return this.#projections;
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    try {
      await disposeStartedPlugins(this.#startedPlugins);
    } finally {
      this.#registry.dispose();
      this.#projections.dispose();
    }
  }
}

function orderPlugins(plugins: readonly Plugin[]): readonly Plugin[] {
  const pluginsById = new Map<string, Plugin>();
  const serviceOwners = new Map<string, string>();

  for (const plugin of plugins) {
    if (pluginsById.has(plugin.id)) {
      throw new RuntimeError(
        'duplicate_plugin_id',
        `Plugin ID "${plugin.id}" is declared more than once.`,
      );
    }
    pluginsById.set(plugin.id, plugin);

    for (const key of plugin.provides ?? []) {
      const existingOwner = serviceOwners.get(key.id);
      if (existingOwner !== undefined) {
        throw new RuntimeError(
          'duplicate_service_owner',
          `Service "${key.id}" is declared by both plugin "${existingOwner}" and plugin "${plugin.id}".`,
        );
      }
      serviceOwners.set(key.id, plugin.id);
    }
  }

  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const plugin of plugins) {
    const pluginDependencies = new Set<string>();
    for (const key of plugin.requires ?? []) {
      const ownerId = serviceOwners.get(key.id);
      if (ownerId === undefined) {
        throw new RuntimeError(
          'missing_dependency',
          `Plugin "${plugin.id}" requires service "${key.id}", but no plugin provides it.`,
        );
      }
      pluginDependencies.add(ownerId);
      const serviceDependents = dependents.get(ownerId) ?? new Set<string>();
      serviceDependents.add(plugin.id);
      dependents.set(ownerId, serviceDependents);
    }
    dependencies.set(plugin.id, pluginDependencies);
  }

  const ready = [...pluginsById.keys()]
    .filter((id) => dependencies.get(id)?.size === 0)
    .sort();
  const ordered: Plugin[] = [];

  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) {
      break;
    }
    const plugin = pluginsById.get(id);
    if (plugin === undefined) {
      throw new Error(`Plugin ordering lost plugin "${id}".`);
    }
    ordered.push(plugin);

    for (const dependentId of dependents.get(id) ?? []) {
      const remaining = dependencies.get(dependentId);
      remaining?.delete(id);
      if (remaining?.size === 0) {
        ready.push(dependentId);
        ready.sort();
      }
    }
  }

  if (ordered.length !== plugins.length) {
    const cycleMembers = [...dependencies.entries()]
      .filter(([, remaining]) => remaining.size > 0)
      .map(([id]) => id)
      .sort();
    throw new RuntimeError(
      'dependency_cycle',
      `Plugin dependency cycle detected among: ${cycleMembers.join(', ')}.`,
    );
  }

  return ordered;
}

async function disposeStartedPlugins(
  startedPlugins: readonly StartedPlugin[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const plugin of [...startedPlugins].reverse()) {
    try {
      await disposeAll(plugin.disposables, plugin.id);
    } catch (error: unknown) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new RuntimeError(
      'plugin_disposal_failed',
      `Failed to dispose ${failures.length.toString()} plugin lifecycle(s).`,
      { cause: new AggregateError(failures) },
    );
  }
}

async function disposeAll(
  disposables: readonly Disposable[],
  pluginId: string,
): Promise<void> {
  const failures: unknown[] = [];
  for (const disposable of [...disposables].reverse()) {
    try {
      await disposable.dispose();
    } catch (error: unknown) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new RuntimeError(
      'plugin_disposal_failed',
      `Plugin "${pluginId}" failed during disposal.`,
      { cause: new AggregateError(failures) },
    );
  }
}
