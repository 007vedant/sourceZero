import type { Disposable } from './disposable.js';
import { toDisposable } from './disposable.js';
import { RuntimeError } from './errors.js';
import type { ServiceKey } from './service-key.js';

interface ServiceRegistration {
  readonly ownerId: string;
  readonly value: unknown;
}

export class ServiceRegistry {
  readonly #services = new Map<string, ServiceRegistration>();
  #disposed = false;

  public register<T>(
    ownerId: string,
    key: ServiceKey<T>,
    service: T,
  ): Disposable {
    this.#assertActive();
    const existing = this.#services.get(key.id);
    if (existing !== undefined) {
      throw new RuntimeError(
        'duplicate_service_owner',
        `Service "${key.id}" is already owned by plugin "${existing.ownerId}"; plugin "${ownerId}" cannot register it.`,
      );
    }

    const registration: ServiceRegistration = { ownerId, value: service };
    this.#services.set(key.id, registration);

    return toDisposable(() => {
      if (this.#services.get(key.id) === registration) {
        this.#services.delete(key.id);
      }
    });
  }

  public get<T>(key: ServiceKey<T>): T {
    this.#assertActive();
    const registration = this.#services.get(key.id);
    if (registration === undefined) {
      throw new RuntimeError(
        'service_unavailable',
        `Service "${key.id}" is not available in the current runtime.`,
      );
    }

    return registration.value as T;
  }

  public has(key: ServiceKey<unknown>): boolean {
    this.#assertActive();
    return this.#services.has(key.id);
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#services.clear();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new RuntimeError(
        'runtime_disposed',
        'The service registry is disposed.',
      );
    }
  }
}
