/**
 * Serializes investigation workspace views for ANSI-free plain and JSON output modes.
 */

import type { InvestigationWorkspaceView } from '@sourcezero/presentation';

export function renderPlainWorkspace(
  workspace: InvestigationWorkspaceView,
): string {
  const input = workspace.overview.originalInput;
  const claim = input.kind === 'url' ? input.url : input.claim;
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
  return `${lines.join('\n')}\n`;
}

export function renderJsonWorkspace(
  workspace: InvestigationWorkspaceView,
): string {
  return `${JSON.stringify(workspace)}\n`;
}
