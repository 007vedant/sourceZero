/**
 * Reserves and commits bounded investigation usage before external work begins.
 */

import { budgetDeltaSchema, type BudgetDelta } from '../domain/events.js';

const dimensions = [
  'searchRequests',
  'retrievedSources',
  'modelTokens',
  'wallClockMs',
  'graphNodes',
] as const;
type BudgetDimension = (typeof dimensions)[number];

export class BudgetExhaustedError extends Error {
  public constructor(public readonly dimension: BudgetDimension) {
    super(`Investigation budget "${dimension}" is exhausted.`);
    this.name = 'BudgetExhaustedError';
  }
}

export interface BudgetReservation {
  commit(actual: BudgetDelta): void;
  release(): void;
}

export interface BudgetAccountant {
  reserve(estimate: BudgetDelta): BudgetReservation;
  snapshot(): Readonly<BudgetDelta>;
}

/** Provides synchronous reservation semantics for one local investigation run. */
export class InMemoryBudgetAccountant implements BudgetAccountant {
  readonly #limits: BudgetDelta;
  readonly #used: Record<BudgetDimension, number> = emptyUsage();
  readonly #reserved: Record<BudgetDimension, number> = emptyUsage();

  public constructor(limits: BudgetDelta) {
    this.#limits = budgetDeltaSchema.parse(limits);
  }

  public reserve(estimate: BudgetDelta): BudgetReservation {
    const parsed = parseDeltaOrEmpty(estimate);
    this.#assertWithinLimits(parsed);
    addInto(this.#reserved, parsed);
    let active = true;
    return {
      commit: (actual) => {
        if (!active) throw new Error('Budget reservation is already settled.');
        const parsedActual = parseDeltaOrEmpty(actual);
        subtractFrom(this.#reserved, parsed);
        addInto(this.#used, parsedActual);
        active = false;
      },
      release: () => {
        if (!active) return;
        subtractFrom(this.#reserved, parsed);
        active = false;
      },
    };
  }

  public snapshot(): Readonly<BudgetDelta> {
    return compact(this.#used);
  }

  #assertWithinLimits(estimate: BudgetDelta): void {
    for (const dimension of dimensions) {
      const limit = this.#limits[dimension];
      if (
        limit !== undefined &&
        this.#used[dimension] +
          this.#reserved[dimension] +
          (estimate[dimension] ?? 0) >
          limit
      ) {
        throw new BudgetExhaustedError(dimension);
      }
    }
  }
}

function parseDeltaOrEmpty(delta: BudgetDelta): BudgetDelta {
  return Object.keys(delta).length === 0 ? {} : budgetDeltaSchema.parse(delta);
}

function emptyUsage(): Record<BudgetDimension, number> {
  return {
    searchRequests: 0,
    retrievedSources: 0,
    modelTokens: 0,
    wallClockMs: 0,
    graphNodes: 0,
  };
}

function addInto(
  target: Record<BudgetDimension, number>,
  delta: BudgetDelta,
): void {
  for (const dimension of dimensions) {
    target[dimension] += delta[dimension] ?? 0;
  }
}

function subtractFrom(
  target: Record<BudgetDimension, number>,
  delta: BudgetDelta,
): void {
  for (const dimension of dimensions) {
    target[dimension] -= delta[dimension] ?? 0;
  }
}

function compact(usage: Record<BudgetDimension, number>): BudgetDelta {
  return Object.fromEntries(
    dimensions
      .filter((dimension) => usage[dimension] > 0)
      .map((dimension) => [dimension, usage[dimension]]),
  );
}
