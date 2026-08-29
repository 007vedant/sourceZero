import { randomUUID } from 'node:crypto';

import { z } from 'zod';

export declare const identifierBrand: unique symbol;

export type Identifier<Name extends string> = string & {
  readonly [identifierBrand]: Name;
};

export type InvestigationId = Identifier<'InvestigationId'>;
export type EventId = Identifier<'EventId'>;
export type SourceId = Identifier<'SourceId'>;
export type ClaimId = Identifier<'ClaimId'>;
export type EvidenceId = Identifier<'EvidenceId'>;
export type RelationshipId = Identifier<'RelationshipId'>;
export type ToolCallId = Identifier<'ToolCallId'>;
export type ArtifactId = Identifier<'ArtifactId'>;

function uuidIdentifierSchema<Name extends string>(prefix: string) {
  return z
    .string()
    .regex(
      new RegExp(
        `^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
        'u',
      ),
      `Expected a ${prefix}-prefixed UUID identifier.`,
    )
    .transform((value) => value as Identifier<Name>);
}

export const investigationIdSchema =
  uuidIdentifierSchema<'InvestigationId'>('inv');
export const eventIdSchema = uuidIdentifierSchema<'EventId'>('evt');
export const sourceIdSchema = uuidIdentifierSchema<'SourceId'>('src');
export const claimIdSchema = uuidIdentifierSchema<'ClaimId'>('clm');
export const evidenceIdSchema = uuidIdentifierSchema<'EvidenceId'>('evd');
export const relationshipIdSchema =
  uuidIdentifierSchema<'RelationshipId'>('rel');
export const toolCallIdSchema = uuidIdentifierSchema<'ToolCallId'>('call');
export const artifactIdSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/u, 'Expected a SHA-256 artifact identifier.')
  .transform((value) => value as ArtifactId);

function createUuidIdentifier<Name extends string>(
  prefix: string,
): Identifier<Name> {
  return `${prefix}_${randomUUID()}` as Identifier<Name>;
}

export const createInvestigationId = (): InvestigationId =>
  createUuidIdentifier<'InvestigationId'>('inv');
export const createEventId = (): EventId =>
  createUuidIdentifier<'EventId'>('evt');
export const createSourceId = (): SourceId =>
  createUuidIdentifier<'SourceId'>('src');
export const createClaimId = (): ClaimId =>
  createUuidIdentifier<'ClaimId'>('clm');
export const createEvidenceId = (): EvidenceId =>
  createUuidIdentifier<'EvidenceId'>('evd');
export const createRelationshipId = (): RelationshipId =>
  createUuidIdentifier<'RelationshipId'>('rel');
export const createToolCallId = (): ToolCallId =>
  createUuidIdentifier<'ToolCallId'>('call');

export function artifactIdFromHexDigest(hexDigest: string): ArtifactId {
  return artifactIdSchema.parse(`sha256:${hexDigest}`);
}
