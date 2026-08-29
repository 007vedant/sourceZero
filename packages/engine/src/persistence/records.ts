import { z } from 'zod';

import {
  artifactIdSchema,
  investigationIdSchema,
} from '../domain/identifiers.js';
import {
  INVESTIGATION_FORMAT_VERSION,
  investigationStatusSchema,
  type InvestigationEvent,
} from '../domain/events.js';

const utcTimestampSchema = z.iso
  .datetime({ offset: true })
  .refine(
    (value) => value.endsWith('Z'),
    'Timestamp must be normalized to UTC.',
  );

export const investigationRecordSchema = z
  .object({
    id: investigationIdSchema,
    formatVersion: z.literal(INVESTIGATION_FORMAT_VERSION),
    status: investigationStatusSchema,
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
    lastSequence: z.number().int().nonnegative(),
  })
  .strict();

export type InvestigationRecord = z.infer<typeof investigationRecordSchema>;

export const ARTIFACT_FORMAT_VERSION = 1 as const;

export const artifactRetentionClassSchema = z.enum([
  'transient',
  'investigation',
  'export',
]);

export type ArtifactRetentionClass = z.infer<
  typeof artifactRetentionClassSchema
>;

export const artifactRecordSchema = z
  .object({
    id: artifactIdSchema,
    algorithm: z.literal('sha256'),
    mediaType: z.string().min(1).max(200),
    byteLength: z.number().int().nonnegative(),
    createdAt: utcTimestampSchema,
    retentionClass: artifactRetentionClassSchema,
    relativeLocation: z
      .string()
      .regex(/^sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}$/u),
    formatVersion: z.literal(ARTIFACT_FORMAT_VERSION),
  })
  .strict();

export type ArtifactRecord = z.infer<typeof artifactRecordSchema>;

export interface ArtifactMetadataRepository {
  getArtifact(id: ArtifactRecord['id']): ArtifactRecord | undefined;
  putArtifact(record: ArtifactRecord): ArtifactRecord;
}

export const projectionCheckpointSchema = z
  .object({
    investigationId: investigationIdSchema,
    projectionId: z.string().min(1).max(200),
    projectionVersion: z.number().int().positive(),
    lastSequence: z.number().int().nonnegative(),
    state: z.json(),
    updatedAt: utcTimestampSchema,
  })
  .strict();

export type ProjectionCheckpoint = z.infer<typeof projectionCheckpointSchema>;

export interface ProjectionCheckpointRepository {
  getProjectionCheckpoint(
    investigationId: ProjectionCheckpoint['investigationId'],
    projectionId: string,
  ): ProjectionCheckpoint | undefined;
  putProjectionCheckpoint(checkpoint: ProjectionCheckpoint): void;
  deleteProjectionCheckpoint(
    investigationId: ProjectionCheckpoint['investigationId'],
    projectionId: string,
  ): void;
}

export interface InvestigationEventSnapshot {
  readonly investigation: InvestigationRecord;
  readonly events: readonly InvestigationEvent[];
}

export interface InvestigationSnapshotReader {
  readInvestigationSnapshot(
    investigationId: InvestigationRecord['id'],
    afterSequence?: number,
  ): InvestigationEventSnapshot;
}
