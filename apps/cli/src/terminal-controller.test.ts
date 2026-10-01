/** Verifies every primary fixture-framing, focus, navigation, scroll, help, and exit key. */

import { describe, expect, it } from 'vitest';

import {
  createTerminalState,
  transitionTerminal,
  workspaceTabs,
  type TerminalKey,
  type TerminalState,
} from './terminal-controller.js';
import { createFixtureWorkspace } from './terminal-fixtures.js';

describe('terminal controller', () => {
  it('enters, edits, and explicitly confirms a manual claim', () => {
    let state = press(createTerminalState(), {
      kind: 'text',
      text: 'Claim one',
    });
    state = press(state, { kind: 'backspace' });
    state = press(state, { kind: 'text', text: 'e' });
    state = press(state, { kind: 'enter' });
    expect(state.screen).toBe('claim_confirmation');

    state = press(state, { kind: 'text', text: 'e' });
    expect(state.screen).toBe('claim_editing');
    state = press(state, { kind: 'text', text: '.' });
    state = press(state, { kind: 'enter' });
    state = press(state, { kind: 'text', text: 'y' });

    expect(state).toMatchObject({
      screen: 'workspace',
      confirmedClaim: 'Claim one.',
      focus: 'tabs',
    });
  });

  it('selects or edits fixture proposals for URL input', () => {
    let state = press(createTerminalState(), {
      kind: 'text',
      text: 'https://example.test/article',
    });
    state = press(state, { kind: 'enter' });
    expect(state.screen).toBe('claim_selection');

    state = press(state, { kind: 'down' });
    state = press(state, { kind: 'up' });
    state = press(state, { kind: 'down' });
    expect(state.selectedProposal).toBe(1);
    state = press(state, { kind: 'text', text: 'e' });
    expect(state.screen).toBe('claim_editing');
    state = press(state, { kind: 'escape' });
    expect(state.screen).toBe('claim_selection');
    state = press(state, { kind: 'enter' });
    expect(state.screen).toBe('claim_confirmation');
  });

  it('navigates tabs, focus, content boundaries, help, and quit', () => {
    let state: TerminalState = {
      ...createTerminalState(),
      screen: 'workspace',
      confirmedClaim: 'Fixture claim.',
    };
    state = press(state, { kind: 'right' });
    state = press(state, { kind: 'down' });
    expect(state.activeTab).toBe(2);
    state = press(state, { kind: 'end' });
    expect(state.activeTab).toBe(workspaceTabs.length - 1);
    state = press(state, { kind: 'home' });
    expect(state.activeTab).toBe(0);
    state = press(state, { kind: 'left' });
    expect(state.activeTab).toBe(workspaceTabs.length - 1);

    state = press(state, { kind: 'tab' });
    state = press(state, { kind: 'down' });
    state = press(state, { kind: 'page_down' });
    expect(state).toMatchObject({ focus: 'content', scrollOffset: 6 });
    state = press(state, { kind: 'up' });
    state = press(state, { kind: 'page_up' });
    state = press(state, { kind: 'end' });
    expect(state.scrollOffset).toBe(Number.MAX_SAFE_INTEGER);
    state = press(state, { kind: 'home' });
    expect(state.scrollOffset).toBe(0);

    state = press(state, { kind: 'help' });
    expect(state.helpVisible).toBe(true);
    state = press(state, { kind: 'escape' });
    expect(state.helpVisible).toBe(false);
    expect(transitionTerminal(state, { kind: 'quit' }).exitRequested).toBe(
      true,
    );
  });

  it('routes graph content keys to viewport interactions', () => {
    const graph = createFixtureWorkspace().graph;
    let state: TerminalState = {
      ...createTerminalState(),
      screen: 'workspace',
      activeTab: 1,
      focus: 'content',
    };
    state = transitionTerminal(state, { kind: 'right' }, graph).state;
    state = transitionTerminal(state, { kind: 'text', text: 'n' }, graph).state;
    state = transitionTerminal(state, { kind: 'text', text: 'v' }, graph).state;

    expect(state.graphViewport).toMatchObject({
      offsetX: 4,
      selectedElementId: 'source_study',
      alternative: 'adjacency',
    });
    expect(state.scrollOffset).toBe(0);
  });
});

function press(state: TerminalState, key: TerminalKey): TerminalState {
  return transitionTerminal(state, key).state;
}
