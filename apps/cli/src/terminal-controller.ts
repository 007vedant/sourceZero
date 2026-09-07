/**
 * Defines deterministic terminal navigation and fixture claim-framing transitions.
 */

import { fixtureClaimProposals } from './terminal-fixtures.js';

export const workspaceTabs = [
  'Overview',
  'Timeline',
  'Evidence',
  'Limitations',
  'Trace',
] as const;

export type WorkspaceTab = (typeof workspaceTabs)[number];
export type TerminalScreen =
  | 'claim_entry'
  | 'claim_selection'
  | 'claim_editing'
  | 'claim_confirmation'
  | 'workspace';
export type FocusArea = 'tabs' | 'content';

export type TerminalKey =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind:
        | 'backspace'
        | 'enter'
        | 'escape'
        | 'up'
        | 'down'
        | 'left'
        | 'right'
        | 'tab'
        | 'page_up'
        | 'page_down'
        | 'home'
        | 'end'
        | 'help'
        | 'quit';
    };

export interface TerminalState {
  readonly screen: TerminalScreen;
  readonly input: string;
  readonly proposals: readonly string[];
  readonly selectedProposal: number;
  readonly confirmedClaim?: string;
  readonly activeTab: number;
  readonly focus: FocusArea;
  readonly scrollOffset: number;
  readonly helpVisible: boolean;
}

export interface TerminalTransition {
  readonly state: TerminalState;
  readonly exitRequested: boolean;
}

export function createTerminalState(): TerminalState {
  return {
    screen: 'claim_entry',
    input: '',
    proposals: fixtureClaimProposals,
    selectedProposal: 0,
    activeTab: 0,
    focus: 'tabs',
    scrollOffset: 0,
    helpVisible: false,
  };
}

export function transitionTerminal(
  state: TerminalState,
  key: TerminalKey,
): TerminalTransition {
  if (key.kind === 'quit') {
    return { state, exitRequested: true };
  }
  if (key.kind === 'help') {
    return {
      state: { ...state, helpVisible: !state.helpVisible },
      exitRequested: false,
    };
  }
  if (state.helpVisible && key.kind === 'escape') {
    return {
      state: { ...state, helpVisible: false },
      exitRequested: false,
    };
  }

  const next = transitionScreen(state, key);
  return { state: next, exitRequested: false };
}

function transitionScreen(
  state: TerminalState,
  key: TerminalKey,
): TerminalState {
  switch (state.screen) {
    case 'claim_entry':
      return transitionClaimEntry(state, key);
    case 'claim_selection':
      return transitionClaimSelection(state, key);
    case 'claim_editing':
      return transitionClaimEditing(state, key);
    case 'claim_confirmation':
      return transitionClaimConfirmation(state, key);
    case 'workspace':
      return transitionWorkspace(state, key);
  }
}

function transitionClaimEntry(
  state: TerminalState,
  key: TerminalKey,
): TerminalState {
  if (key.kind === 'text') {
    return { ...state, input: `${state.input}${key.text}` };
  }
  if (key.kind === 'backspace') {
    return { ...state, input: state.input.slice(0, -1) };
  }
  if (key.kind !== 'enter' || state.input.trim().length === 0) {
    return state;
  }
  if (looksLikeUrl(state.input)) {
    return { ...state, screen: 'claim_selection', selectedProposal: 0 };
  }
  return {
    ...state,
    screen: 'claim_confirmation',
    input: state.input.trim(),
  };
}

function transitionClaimSelection(
  state: TerminalState,
  key: TerminalKey,
): TerminalState {
  if (key.kind === 'up') {
    return {
      ...state,
      selectedProposal: wrap(
        state.selectedProposal - 1,
        state.proposals.length,
      ),
    };
  }
  if (key.kind === 'down') {
    return {
      ...state,
      selectedProposal: wrap(
        state.selectedProposal + 1,
        state.proposals.length,
      ),
    };
  }
  if (key.kind === 'text' && key.text.toLowerCase() === 'e') {
    return {
      ...state,
      screen: 'claim_editing',
      input: state.proposals[state.selectedProposal] ?? '',
    };
  }
  if (key.kind === 'enter') {
    return {
      ...state,
      screen: 'claim_confirmation',
      input: state.proposals[state.selectedProposal] ?? '',
    };
  }
  if (key.kind === 'escape') {
    return { ...state, screen: 'claim_entry' };
  }
  return state;
}

function transitionClaimEditing(
  state: TerminalState,
  key: TerminalKey,
): TerminalState {
  if (key.kind === 'text') {
    return { ...state, input: `${state.input}${key.text}` };
  }
  if (key.kind === 'backspace') {
    return { ...state, input: state.input.slice(0, -1) };
  }
  if (key.kind === 'enter' && state.input.trim().length > 0) {
    return {
      ...state,
      screen: 'claim_confirmation',
      input: state.input.trim(),
    };
  }
  if (key.kind === 'escape') {
    return { ...state, screen: 'claim_selection' };
  }
  return state;
}

function transitionClaimConfirmation(
  state: TerminalState,
  key: TerminalKey,
): TerminalState {
  if (key.kind === 'text' && key.text.toLowerCase() === 'y') {
    return {
      ...state,
      screen: 'workspace',
      confirmedClaim: state.input,
      focus: 'tabs',
      scrollOffset: 0,
    };
  }
  if (key.kind === 'text' && key.text.toLowerCase() === 'e') {
    return { ...state, screen: 'claim_editing' };
  }
  if (key.kind === 'escape') {
    return { ...state, screen: 'claim_entry' };
  }
  return state;
}

function transitionWorkspace(
  state: TerminalState,
  key: TerminalKey,
): TerminalState {
  if (key.kind === 'tab') {
    return {
      ...state,
      focus: state.focus === 'tabs' ? 'content' : 'tabs',
    };
  }
  if (state.focus === 'tabs') {
    if (key.kind === 'left' || key.kind === 'up') {
      return changeTab(state, state.activeTab - 1);
    }
    if (key.kind === 'right' || key.kind === 'down') {
      return changeTab(state, state.activeTab + 1);
    }
    if (key.kind === 'home') {
      return changeTab(state, 0);
    }
    if (key.kind === 'end') {
      return changeTab(state, workspaceTabs.length - 1);
    }
    return state;
  }
  switch (key.kind) {
    case 'up':
      return { ...state, scrollOffset: Math.max(0, state.scrollOffset - 1) };
    case 'down':
      return { ...state, scrollOffset: state.scrollOffset + 1 };
    case 'page_up':
      return { ...state, scrollOffset: Math.max(0, state.scrollOffset - 5) };
    case 'page_down':
      return { ...state, scrollOffset: state.scrollOffset + 5 };
    case 'home':
      return { ...state, scrollOffset: 0 };
    case 'end':
      return { ...state, scrollOffset: Number.MAX_SAFE_INTEGER };
    default:
      return state;
  }
}

function changeTab(state: TerminalState, activeTab: number): TerminalState {
  return {
    ...state,
    activeTab: wrap(activeTab, workspaceTabs.length),
    scrollOffset: 0,
  };
}

function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value.trim());
}
