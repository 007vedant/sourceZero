/** Verifies deterministic responsive and accessible frames across required lifecycle states. */

import { describe, expect, it } from 'vitest';

import {
  createTerminalState,
  type TerminalState,
} from './terminal-controller.js';
import { renderTerminalFrame } from './terminal-frame.js';
import { createFixtureWorkspace } from './terminal-fixtures.js';

const accessibility = { screenReader: false, reducedDecoration: false };

describe('terminal frames', () => {
  it('renders a wide running workspace with a status sidebar', () => {
    const frame = renderTerminalFrame(
      workspaceState(),
      createFixtureWorkspace('running'),
      { columns: 100, rows: 20 },
      accessibility,
    );

    expect(frame).toContain('[Overview]');
    expect(frame).toContain('Investigation status');
    expect(frame).toContain('Status: running');
    expectBounded(frame, 100, 20);
  });

  it('switches a narrow terminal to a single-pane evidence view', () => {
    const frame = renderTerminalFrame(
      { ...workspaceState(), activeTab: 2 },
      createFixtureWorkspace('running'),
      { columns: 44, rows: 14 },
      accessibility,
    );

    expect(frame).toContain('Evidence view');
    expect(frame).not.toContain('Investigation status');
    expectBounded(frame, 44, 14);
  });

  it.each(['draft', 'running', 'failed', 'canceled', 'completed'])(
    'renders a fixed frame for %s investigations',
    (status) => {
      const frame = renderTerminalFrame(
        workspaceState(),
        createFixtureWorkspace(status),
        { columns: 72, rows: 16 },
        accessibility,
      );

      expect(frame).toContain(`Status: ${status}`);
      expectBounded(frame, 72, 16);
    },
  );

  it('renders explicit empty-state and screen-reader labels without decoration', () => {
    const frame = renderTerminalFrame(
      { ...workspaceState(), activeTab: 2 },
      createFixtureWorkspace('draft'),
      { columns: 60, rows: 14 },
      { screenReader: true, reducedDecoration: true },
    );

    expect(frame).toContain('SourceZero. Trace every claim back to zero.');
    expect(frame).toContain('Tabs. Selected Evidence, 3 of 5.');
    expect(frame).toContain('No evidence has been recorded yet.');
    expect(frame).not.toContain('[Evidence]');
  });
});

function workspaceState(): TerminalState {
  return {
    ...createTerminalState(),
    screen: 'workspace',
    confirmedClaim: 'Fixture claim.',
  };
}

function expectBounded(frame: string, columns: number, rows: number): void {
  const lines = frame.split('\n');
  expect(lines.length).toBeLessThanOrEqual(rows);
  expect(lines.every((line) => line.length <= columns)).toBe(true);
}
