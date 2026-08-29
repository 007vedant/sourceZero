import { describe, expect, it } from 'vitest';

import {
  artifactIdFromHexDigest,
  createClaimId,
  createEventId,
  createEvidenceId,
  createInvestigationId,
  createRelationshipId,
  createSourceId,
  createToolCallId,
  investigationIdSchema,
} from './identifiers.js';

describe('durable identifiers', () => {
  it('creates distinct, boundary-valid identifiers for every durable identity', () => {
    const ids = [
      createInvestigationId(),
      createEventId(),
      createSourceId(),
      createClaimId(),
      createEvidenceId(),
      createRelationshipId(),
      createToolCallId(),
    ];

    expect(new Set(ids)).toHaveLength(ids.length);
    expect(ids).toEqual([
      expect.stringMatching(/^inv_/u),
      expect.stringMatching(/^evt_/u),
      expect.stringMatching(/^src_/u),
      expect.stringMatching(/^clm_/u),
      expect.stringMatching(/^evd_/u),
      expect.stringMatching(/^rel_/u),
      expect.stringMatching(/^call_/u),
    ]);
  });

  it('rejects malformed cross-boundary identifiers', () => {
    expect(() => investigationIdSchema.parse('inv_not-a-uuid')).toThrow();
    expect(() => artifactIdFromHexDigest('abc')).toThrow();
  });
});
