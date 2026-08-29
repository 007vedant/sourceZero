import { z } from 'zod';

import {
  eventIdSchema,
  investigationIdSchema,
  toolCallIdSchema,
  type InvestigationId,
} from './identifiers.js';

export const EVENT_SCHEMA_VERSION = 1 as const;
export const INVESTIGATION_FORMAT_VERSION = 1 as const;

const utcTimestampSchema = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => value.endsWith('Z'),
    'Timestamp must be normalized to UTC.',
  );

export const producerIdentitySchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('user'), userId: z.string().min(1).optional() })
    .strict(),
  z
    .object({ kind: z.literal('system'), component: z.string().min(1) })
    .strict(),
  z
    .object({
      kind: z.literal('model'),
      providerId: z.string().min(1),
      modelId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tool'),
      toolName: z.string().min(1),
      toolCallId: toolCallIdSchema,
    })
    .strict(),
]);

export type ProducerIdentity = z.infer<typeof producerIdentitySchema>;

export const investigationStatusSchema = z.enum([
  'draft',
  'awaiting_confirmation',
  'ready',
  'running',
  'completed',
  'canceled',
  'failed',
  'budget_exhausted',
  'interrupted',
]);

export type InvestigationStatus = z.infer<typeof investigationStatusSchema>;

export const investigationPolicySchema = z
  .object({
    maxSearchRequests: z.number().int().nonnegative(),
    maxRetrievedSources: z.number().int().positive(),
    maxTraversalDepth: z.number().int().nonnegative(),
    maxModelTokens: z.number().int().positive(),
    maxWallClockMs: z.number().int().positive(),
    perToolTimeoutMs: z.number().int().positive(),
    maxRetries: z.number().int().nonnegative(),
    maxGraphNodes: z.number().int().positive(),
  })
  .strict();

export type InvestigationPolicy = z.infer<typeof investigationPolicySchema>;

export const originalInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claim'), claim: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('url'), url: z.url() }).strict(),
  z
    .object({
      kind: z.literal('claim_and_url'),
      claim: z.string().min(1),
      url: z.url(),
    })
    .strict(),
]);

export type OriginalInput = z.infer<typeof originalInputSchema>;

const envelopeSchema = z.object({
  investigationId: investigationIdSchema,
  eventId: eventIdSchema,
  sequence: z.number().int().positive(),
  occurredAt: utcTimestampSchema,
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  producer: producerIdentitySchema,
  causationId: eventIdSchema.optional(),
  correlationId: z.string().min(1).max(200).optional(),
});

const investigationCreatedEventSchema = envelopeSchema
  .extend({
    type: z.literal('investigation.created'),
    data: z
      .object({
        formatVersion: z.literal(INVESTIGATION_FORMAT_VERSION),
        originalInput: originalInputSchema,
      })
      .strict(),
  })
  .strict();

const investigationPolicyResolvedEventSchema = envelopeSchema
  .extend({
    type: z.literal('investigation.policy_resolved'),
    data: z.object({ policy: investigationPolicySchema }).strict(),
  })
  .strict();

const investigationStatusChangedEventSchema = envelopeSchema
  .extend({
    type: z.literal('investigation.status_changed'),
    data: z
      .object({
        from: investigationStatusSchema,
        to: investigationStatusSchema,
        reason: z.string().min(1).max(2_000).optional(),
      })
      .strict(),
  })
  .strict();

export const investigationEventSchema = z.discriminatedUnion('type', [
  investigationCreatedEventSchema,
  investigationPolicyResolvedEventSchema,
  investigationStatusChangedEventSchema,
]);

type DeepReadonly<Value> = Value extends
  string | number | boolean | bigint | symbol | null | undefined
  ? Value
  : Value extends (...args: never[]) => unknown
    ? Value
    : Value extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;

export type InvestigationEvent = DeepReadonly<
  z.infer<typeof investigationEventSchema>
>;
export type InvestigationCreatedEvent = Extract<
  InvestigationEvent,
  { type: 'investigation.created' }
>;

export type InvestigationEventDraft = {
  [Event in InvestigationEvent as Event['type']]: Omit<
    Event,
    'investigationId' | 'sequence'
  >;
}[InvestigationEvent['type']];

export type InvestigationCreatedEventDraft = Omit<
  InvestigationCreatedEvent,
  'investigationId' | 'sequence'
>;

export function materializeEvent(
  investigationId: InvestigationId,
  sequence: number,
  draft: InvestigationEventDraft,
): InvestigationEvent {
  return parseInvestigationEvent({
    ...draft,
    investigationId,
    sequence,
  });
}

export function parseInvestigationEvent(value: unknown): InvestigationEvent {
  const result = investigationEventSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError('Investigation event failed runtime validation.');
  }
  return deepFreeze(result.data);
}

export function isStatusChangedEvent(
  event: InvestigationEvent,
): event is Extract<
  InvestigationEvent,
  { type: 'investigation.status_changed' }
> {
  return event.type === 'investigation.status_changed';
}

function deepFreeze<Value>(value: Value): DeepReadonly<Value> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<Value>;
}
