/**
 * Supplies deterministic framing proposals and investigation views for terminal development.
 */

import type { InvestigationWorkspaceView } from '@sourcezero/presentation';

export const fixtureClaimProposals = [
  'AI assistants reduce completion time for software tasks.',
  'Developers using AI assistants complete tasks 55% faster.',
  'The measured productivity effect varies by developer experience.',
] as const;

export function createFixtureWorkspace(
  status = 'running',
  claim = 'Developers using AI assistants complete tasks 55% faster.',
): InvestigationWorkspaceView {
  return {
    investigationId: 'inv_fixture_terminal',
    overview: {
      status,
      originalInput: { kind: 'claim', claim },
      sourceCount: status === 'draft' ? 0 : 6,
      relationshipCount: status === 'draft' ? 0 : 8,
    },
    progress: {
      status,
      stage: stageForStatus(status),
    },
    budget: {
      configured: true,
      limits: { searchRequests: 12, retrievedSources: 20, modelTokens: 20_000 },
      usage: {
        searchRequests: status === 'draft' ? 0 : 4,
        retrievedSources: status === 'draft' ? 0 : 6,
        modelTokens: status === 'draft' ? 0 : 4200,
      },
    },
    graph: { nodes: [], edges: [] },
    timeline: {
      entries:
        status === 'draft'
          ? []
          : [
              {
                id: 'mutation_1',
                occurredAt: '2023-06-01',
                wording: 'Participants completed the selected task faster.',
              },
              {
                id: 'mutation_2',
                occurredAt: '2024-01-12',
                wording: 'AI makes all developers 55% more productive.',
              },
            ],
    },
    evidence: {
      rows:
        status === 'draft'
          ? []
          : [
              {
                id: 'evidence_1',
                sourceId: 'source_study',
                excerpt:
                  'Participants completed the task 55% faster on average.',
              },
              {
                id: 'evidence_2',
                sourceId: 'source_article',
                excerpt:
                  'The article repeats the percentage without the study caveats.',
              },
            ],
    },
    limitations: {
      items: [
        {
          id: 'limitation_1',
          kind: 'scope',
          message: 'Earliest located does not mean absolute first publication.',
        },
      ],
    },
    trace: {
      entries: [
        {
          eventId: 'evt_fixture_1',
          sequence: 1,
          type: 'investigation.created',
          occurredAt: '2026-08-29T12:00:00.000Z',
          producerKind: 'user',
        },
        {
          eventId: 'evt_fixture_2',
          sequence: 2,
          type: `investigation.${status}`,
          occurredAt: '2026-08-29T12:00:01.000Z',
          producerKind: 'system',
        },
      ],
    },
    availableActions: [
      { type: 'inspect_section', section: 'overview' },
      { type: 'inspect_section', section: 'timeline' },
      { type: 'inspect_section', section: 'evidence' },
      { type: 'inspect_section', section: 'limitations' },
      { type: 'inspect_section', section: 'trace' },
    ],
  };
}

function stageForStatus(
  status: string,
): InvestigationWorkspaceView['progress']['stage'] {
  switch (status) {
    case 'draft':
      return 'framing';
    case 'awaiting_confirmation':
      return 'ready';
    case 'running':
      return 'investigating';
    case 'completed':
      return 'finished';
    case 'failed':
    case 'canceled':
      return 'stopped';
    default:
      return 'stopped';
  }
}
