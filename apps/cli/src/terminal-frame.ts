/**
 * Renders bounded deterministic terminal frames from client-neutral workspace models.
 */

import type { InvestigationWorkspaceView } from '@sourcezero/presentation';

import type { TerminalState, WorkspaceTab } from './terminal-controller.js';
import { workspaceTabs } from './terminal-controller.js';

export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

export interface TerminalAccessibilityOptions {
  readonly screenReader: boolean;
  readonly reducedDecoration: boolean;
}

const minimumColumns = 20;
const minimumRows = 8;
const wideLayoutColumns = 80;

export function renderTerminalFrame(
  state: TerminalState,
  workspace: InvestigationWorkspaceView,
  dimensions: TerminalDimensions,
  accessibility: TerminalAccessibilityOptions,
): string {
  const width = Math.max(minimumColumns, dimensions.columns);
  const height = Math.max(minimumRows, dimensions.rows);
  const lines = [header(accessibility), ''];
  if (state.helpVisible) {
    lines.push(...helpLines(accessibility));
  } else if (state.screen === 'workspace') {
    lines.push(
      ...workspaceLines(state, workspace, width, height, accessibility),
    );
  } else {
    lines.push(...framingLines(state, width, accessibility));
  }
  return fitFrame(lines, width, height).join('\n');
}

function header(accessibility: TerminalAccessibilityOptions): string {
  if (accessibility.screenReader) {
    return 'SourceZero. Trace every claim back to zero.';
  }
  return accessibility.reducedDecoration
    ? 'SourceZero - Trace every claim back to zero.'
    : 'SourceZero  |  Trace every claim back to zero.';
}

function framingLines(
  state: TerminalState,
  width: number,
  accessibility: TerminalAccessibilityOptions,
): string[] {
  switch (state.screen) {
    case 'claim_entry':
      return [
        'Claim entry',
        'Enter one claim or a public HTTP/HTTPS URL:',
        ...wrapText(state.input.length === 0 ? '(empty)' : state.input, width),
        '',
        'Enter continue  ? help  Ctrl+C quit',
      ];
    case 'claim_selection':
      return [
        'Claim selection',
        'Choose one proposed claim:',
        ...state.proposals.flatMap((proposal, index) =>
          wrapText(
            `${selectionMarker(index === state.selectedProposal, accessibility)} ${(index + 1).toString()}. ${proposal}`,
            width,
          ),
        ),
        '',
        'Up/Down select  Enter continue  E edit  Esc back',
      ];
    case 'claim_editing':
      return [
        'Claim editing',
        ...wrapText(state.input.length === 0 ? '(empty)' : state.input, width),
        '',
        'Type to edit  Backspace delete  Enter continue  Esc back',
      ];
    case 'claim_confirmation':
      return [
        'Confirm investigation claim',
        ...wrapText(`Investigate: “${state.input}”`, width),
        '',
        'Y confirm  E edit  Esc restart',
      ];
    case 'workspace':
      return [];
  }
}

function workspaceLines(
  state: TerminalState,
  workspace: InvestigationWorkspaceView,
  width: number,
  height: number,
  accessibility: TerminalAccessibilityOptions,
): string[] {
  const activeTab = workspaceTabs[state.activeTab] ?? 'Overview';
  const tabLine = accessibility.screenReader
    ? `Tabs. Selected ${activeTab}, ${(state.activeTab + 1).toString()} of ${workspaceTabs.length.toString()}.`
    : workspaceTabs
        .map((tab, index) =>
          index === state.activeTab ? `[${tab}]` : ` ${tab} `,
        )
        .join(' ');
  const focusLine = `Focus: ${state.focus}. Tab changes focus; arrows navigate; ? opens help; Ctrl+C quits.`;
  const content = sectionLines(activeTab, workspace);
  const reservedRows = 7;
  const availableRows = Math.max(1, height - reservedRows);
  const offset = Math.min(
    state.scrollOffset,
    Math.max(0, content.length - availableRows),
  );
  const visible = content.slice(offset, offset + availableRows);

  if (width < wideLayoutColumns) {
    return [
      tabLine,
      focusLine,
      '',
      `${activeTab} view`,
      ...visible,
      '',
      `${(offset + 1).toString()}-${Math.min(offset + visible.length, content.length).toString()} of ${Math.max(1, content.length).toString()}`,
    ];
  }

  const leftWidth = Math.floor(width * 0.68);
  const sidebar = [
    'Investigation status',
    `Status: ${workspace.overview.status}`,
    `Stage: ${workspace.progress.stage}`,
    `Sources: ${workspace.overview.sourceCount.toString()}`,
    `Relationships: ${workspace.overview.relationshipCount.toString()}`,
    `Search: ${numberValue(workspace.budget.usage, 'searchRequests').toString()}/${numberValue(workspace.budget.limits, 'searchRequests').toString()}`,
  ];
  const rowCount = Math.max(visible.length, sidebar.length);
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const left = truncate(visible[index] ?? '', leftWidth).padEnd(leftWidth);
    return `${left} | ${sidebar[index] ?? ''}`;
  });
  return [tabLine, focusLine, '', `${activeTab} view`, ...rows];
}

function sectionLines(
  tab: WorkspaceTab,
  workspace: InvestigationWorkspaceView,
): string[] {
  switch (tab) {
    case 'Overview':
      return [
        `Claim: ${claimText(workspace)}`,
        `Status: ${workspace.overview.status}`,
        `Stage: ${workspace.progress.stage}`,
        `Sources: ${workspace.overview.sourceCount.toString()}`,
        `Relationships: ${workspace.overview.relationshipCount.toString()}`,
        `Budget configured: ${workspace.budget.configured ? 'yes' : 'no'}`,
      ];
    case 'Timeline':
      return workspace.timeline.entries.length === 0
        ? ['No mutation timeline entries yet.']
        : workspace.timeline.entries.flatMap((entry) => [
            `${entry.occurredAt}  ${entry.wording}`,
          ]);
    case 'Evidence':
      return workspace.evidence.rows.length === 0
        ? ['No evidence has been recorded yet.']
        : workspace.evidence.rows.flatMap((row) => [
            `${row.sourceId}: ${row.excerpt}`,
          ]);
    case 'Limitations':
      return workspace.limitations.items.length === 0
        ? ['No limitations have been recorded yet.']
        : workspace.limitations.items.flatMap((item) => [
            `${item.kind}: ${item.message}`,
          ]);
    case 'Trace':
      return workspace.trace.entries.length === 0
        ? ['No trace events have been recorded yet.']
        : workspace.trace.entries.flatMap((entry) => [
            `#${entry.sequence.toString()} ${entry.type} (${entry.producerKind})`,
          ]);
  }
}

function helpLines(accessibility: TerminalAccessibilityOptions): string[] {
  const prefix = accessibility.screenReader
    ? 'Keyboard help.'
    : 'Keyboard help';
  return [
    prefix,
    'Tab              Move focus between tabs and content',
    'Arrow keys       Select tabs or scroll content',
    'Page Up/Down     Scroll content by five rows',
    'Home/End         First/last tab or content boundary',
    '?                Open or close this help',
    'Escape           Close help or return to the previous framing step',
    'Ctrl+C or Q      Exit safely',
  ];
}

function selectionMarker(
  selected: boolean,
  accessibility: TerminalAccessibilityOptions,
): string {
  if (accessibility.screenReader) {
    return selected ? 'Selected' : 'Option';
  }
  return selected ? '>' : ' ';
}

function fitFrame(
  lines: readonly string[],
  width: number,
  height: number,
): string[] {
  const wrapped = lines.flatMap((line) => wrapText(line, width));
  return wrapped.slice(0, height).map((line) => truncate(line, width));
}

function wrapText(text: string, width: number): string[] {
  if (text.length === 0) {
    return [''];
  }
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > width) {
    const candidate = remaining.slice(0, width + 1);
    const breakAt = Math.max(candidate.lastIndexOf(' '), width);
    lines.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }
  lines.push(remaining);
  return lines;
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : value.slice(0, width);
}

function claimText(workspace: InvestigationWorkspaceView): string {
  const input = workspace.overview.originalInput;
  switch (input.kind) {
    case 'claim':
      return input.claim;
    case 'url':
      return input.url;
    case 'claim_and_url':
      return input.claim;
  }
}

function numberValue(
  record: Readonly<Record<string, number>>,
  key: string,
): number {
  return record[key] ?? 0;
}
