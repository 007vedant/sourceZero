/**
 * Supplies deterministic framing proposals and investigation views for terminal development.
 */

import type {
  InvestigationWorkspaceView,
  ProvenanceGraphView,
} from '@sourcezero/presentation';

export const fixtureClaimProposals = [
  'AI assistants reduce completion time for software tasks.',
  'Developers using AI assistants complete tasks 55% faster.',
  'The measured productivity effect varies by developer experience.',
] as const;

export function createFixtureWorkspace(
  status = 'running',
  claim = 'Developers using AI assistants complete tasks 55% faster.',
): InvestigationWorkspaceView {
  const graph = status === 'draft' ? { nodes: [], edges: [] } : fixtureGraph();
  return {
    investigationId: 'inv_fixture_terminal',
    overview: {
      status,
      originalInput: { kind: 'claim', claim },
      sourceCount: graph.nodes.filter((node) => node.kind === 'source').length,
      relationshipCount: graph.edges.length,
    },
    progress: {
      status,
      stage: stageForStatus(status),
    },
    framing: {
      proposals: [
        {
          claimId: 'clm_fixture_terminal',
          wording: claim,
          origin: 'manual_normalization',
        },
      ],
      workingClaim: { claimId: 'clm_fixture_terminal', wording: claim },
      ...(status === 'draft' || status === 'awaiting_confirmation'
        ? {}
        : {
            confirmedClaim: {
              claimId: 'clm_fixture_terminal',
              wording: claim,
            },
          }),
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
    graph,
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
      { type: 'inspect_section', section: 'graph' },
      { type: 'inspect_section', section: 'timeline' },
      { type: 'inspect_section', section: 'evidence' },
      { type: 'inspect_section', section: 'limitations' },
      { type: 'inspect_section', section: 'trace' },
    ],
  };
}

function fixtureGraph(): ProvenanceGraphView {
  const evidence = [
    {
      id: 'evidence_excerpt',
      excerpt: 'The fixture records the exact supporting passage.',
    },
  ];
  return {
    nodes: [
      {
        id: 'source_study',
        kind: 'source',
        label: 'Original study',
        detail: { summary: 'First located study in this fixture.', evidence },
      },
      {
        id: 'source_interview',
        kind: 'source',
        label: 'Independent interview',
        detail: { summary: 'A competing independent account.', evidence },
      },
      {
        id: 'source_report_a',
        kind: 'source',
        label: 'Syndicated report A',
        duplicateGroupId: 'duplicate_reports',
        detail: { summary: 'One member of a duplicate group.', evidence },
      },
      {
        id: 'source_report_b',
        kind: 'source',
        label: 'Syndicated report B',
        duplicateGroupId: 'duplicate_reports',
        detail: { summary: 'One member of a duplicate group.', evidence },
      },
      {
        id: 'claim_main',
        kind: 'claim',
        label: '55% faster claim',
        detail: { summary: 'The claim under investigation.', evidence },
      },
      {
        id: 'evidence_measurement',
        kind: 'evidence',
        label: 'Measured task result',
        detail: { summary: 'Exact evidence supporting the study.', evidence },
      },
    ],
    edges: [
      {
        id: 'edge_study_report_a',
        sourceId: 'source_study',
        targetId: 'source_report_a',
        type: 'cites',
        detail: { summary: 'Report A cites the study.', evidence },
      },
      {
        id: 'edge_study_report_b',
        sourceId: 'source_study',
        targetId: 'source_report_b',
        type: 'syndicates',
        detail: { summary: 'Report B repeats the study.', evidence },
      },
      {
        id: 'edge_report_a_claim',
        sourceId: 'source_report_a',
        targetId: 'claim_main',
        type: 'paraphrases',
        detail: { summary: 'Report A broadens the wording.', evidence },
      },
      {
        id: 'edge_report_b_claim',
        sourceId: 'source_report_b',
        targetId: 'claim_main',
        type: 'copies',
        detail: { summary: 'Report B repeats the claim.', evidence },
      },
      {
        id: 'edge_interview_claim',
        sourceId: 'source_interview',
        targetId: 'claim_main',
        type: 'independently_supports',
        detail: {
          summary: 'The interview independently supports it.',
          evidence,
        },
      },
      {
        id: 'edge_evidence_study',
        sourceId: 'evidence_measurement',
        targetId: 'source_study',
        type: 'independently_supports',
        detail: { summary: 'The measurement supports the study.', evidence },
      },
      {
        id: 'edge_feedback',
        sourceId: 'claim_main',
        targetId: 'source_report_a',
        type: 'unresolved_dependency',
        detail: {
          summary: 'Fixture cycle for explicit feedback routing.',
          evidence,
        },
      },
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
