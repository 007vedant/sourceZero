/**
 * Serializes investigation workspace views for ANSI-free plain and JSON output modes.
 */

import type { InvestigationWorkspaceView } from '@sourcezero/presentation';

export function renderPlainWorkspace(
  workspace: InvestigationWorkspaceView,
): string {
  const input = workspace.overview.originalInput;
  const claim =
    workspace.framing.confirmedClaim?.wording ??
    workspace.framing.workingClaim?.wording ??
    (input.kind === 'url' ? input.url : input.claim);
  const lines = [
    `Investigation: ${workspace.investigationId}`,
    `Claim: ${claim}`,
    `Status: ${workspace.overview.status}`,
    `Stage: ${workspace.progress.stage}`,
    `Sources: ${workspace.overview.sourceCount.toString()}`,
    `Relationships: ${workspace.overview.relationshipCount.toString()}`,
    `Evidence rows: ${workspace.evidence.rows.length.toString()}`,
    `Limitations: ${workspace.limitations.items.length.toString()}`,
    `Trace events: ${workspace.trace.entries.length.toString()}`,
  ];
  if (workspace.framing.proposals.length > 1) {
    lines.push('Proposed claims:');
    workspace.framing.proposals.forEach((proposal, index) => {
      lines.push(`  ${(index + 1).toString()}. ${proposal.wording}`);
    });
  }
  if (workspace.framing.failure !== undefined) {
    lines.push(
      `Framing failure: ${workspace.framing.failure.code} (${workspace.framing.failure.stage})`,
      `Failure detail: ${workspace.framing.failure.message}`,
    );
  } else if (workspace.overview.status === 'awaiting_confirmation') {
    lines.push(
      'Confirmation required: rerun with --confirm to start the bounded investigation.',
    );
  }
  return `${lines.join('\n')}\n`;
}

export function renderJsonWorkspace(
  workspace: InvestigationWorkspaceView,
): string {
  return `${JSON.stringify(workspace)}\n`;
}
