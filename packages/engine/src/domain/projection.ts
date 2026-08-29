/**
 * Defines the pure, versioned fold contract shared by replay, checkpoints, and clients.
 */

import type { z } from 'zod';

import type { InvestigationEvent } from './events.js';

export interface ProjectionDefinition<State, View> {
  readonly id: string;
  readonly version: number;
  readonly stateSchema: z.ZodType<State>;
  init(): State;
  apply(state: State, event: InvestigationEvent): State;
  view(state: State): View;
}
