/**
 * Owns deterministic projection registration and lifecycle-safe removal.
 */

import type { ProjectionDefinition } from '../domain/projection.js';
import { toDisposable, type Disposable } from './disposable.js';
import { RuntimeError } from './errors.js';

interface ProjectionRegistration {
  readonly ownerId: string;
  readonly definition: object;
  readonly version: number;
}

/** Registers projection definitions while preserving their lifecycle owner. */
export class ProjectionRegistry {
  readonly #registrations = new Map<string, ProjectionRegistration>();
  #disposed = false;

  public register<State, View>(
    ownerId: string,
    definition: ProjectionDefinition<State, View>,
  ): Disposable {
    this.#assertActive();
    const id = definition.id.trim();
    if (
      id.length === 0 ||
      !Number.isInteger(definition.version) ||
      definition.version <= 0
    ) {
      throw new RuntimeError(
        'invalid_projection_definition',
        'Projection IDs must be non-empty and versions must be positive integers.',
      );
    }
    const existing = this.#registrations.get(id);
    if (existing !== undefined) {
      throw new RuntimeError(
        'duplicate_projection_id',
        `Projection "${id}" is already owned by plugin "${existing.ownerId}"; plugin "${ownerId}" cannot register it.`,
      );
    }

    const registration: ProjectionRegistration = {
      ownerId,
      definition,
      version: definition.version,
    };
    this.#registrations.set(id, registration);
    return toDisposable(() => {
      if (this.#registrations.get(id) === registration) {
        this.#registrations.delete(id);
      }
    });
  }

  public assertRegistered<State, View>(
    definition: ProjectionDefinition<State, View>,
  ): void {
    this.#assertActive();
    const registration = this.#registrations.get(definition.id);
    if (registration?.definition !== definition) {
      throw new RuntimeError(
        'projection_not_registered',
        `Projection "${definition.id}" is not registered in this runtime.`,
      );
    }
  }

  public list(): readonly { readonly id: string; readonly version: number }[] {
    this.#assertActive();
    return [...this.#registrations.entries()]
      .map(([id, registration]) => ({ id, version: registration.version }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#registrations.clear();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new RuntimeError(
        'runtime_disposed',
        'The projection registry is disposed.',
      );
    }
  }
}
