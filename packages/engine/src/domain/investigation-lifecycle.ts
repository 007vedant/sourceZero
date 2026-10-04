/** Defines legal investigation status transitions and framing mutation guards. */

import type { InvestigationStatus } from './events.js';

export type LifecycleViolationCode =
  | 'illegal_status_transition'
  | 'claim_not_editable'
  | 'explicit_reframe_required';

/** Reports a deterministic lifecycle command rejection. */
export class LifecycleViolation extends Error {
  public constructor(
    public readonly code: LifecycleViolationCode,
    message: string,
  ) {
    super(message);
    this.name = 'LifecycleViolation';
  }
}

const legalTransitions: Readonly<
  Record<InvestigationStatus, readonly InvestigationStatus[]>
> = {
  draft: ['awaiting_confirmation', 'failed', 'canceled', 'budget_exhausted'],
  awaiting_confirmation: ['ready', 'failed', 'canceled'],
  ready: ['running', 'awaiting_confirmation', 'canceled'],
  running: [
    'completed',
    'canceled',
    'failed',
    'budget_exhausted',
    'interrupted',
    'awaiting_confirmation',
  ],
  completed: ['awaiting_confirmation'],
  canceled: ['awaiting_confirmation'],
  failed: ['awaiting_confirmation'],
  budget_exhausted: ['awaiting_confirmation'],
  interrupted: ['awaiting_confirmation'],
};

export function assertStatusTransition(
  from: InvestigationStatus,
  to: InvestigationStatus,
): void {
  if (!legalTransitions[from].includes(to)) {
    throw new LifecycleViolation(
      'illegal_status_transition',
      `Investigation cannot transition from "${from}" to "${to}".`,
    );
  }
}

export function assertClaimEditable(status: InvestigationStatus): void {
  if (status === 'awaiting_confirmation') return;
  if (status === 'draft') {
    throw new LifecycleViolation(
      'claim_not_editable',
      'A claim can be edited only after a framing proposal exists.',
    );
  }
  throw new LifecycleViolation(
    'explicit_reframe_required',
    'Changing a claim after framing requires an explicit restart or branch.',
  );
}

export function requiresExplicitReframe(status: InvestigationStatus): boolean {
  return status !== 'draft' && status !== 'awaiting_confirmation';
}
