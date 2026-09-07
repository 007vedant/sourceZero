/**
 * Adapts Ink input, resize, and accessibility hooks to the pure terminal workspace model.
 */

import { Text, useApp, useInput, useWindowSize, type Key } from 'ink';
import { useMemo, useState } from 'react';

import {
  createTerminalState,
  transitionTerminal,
  type TerminalKey,
  type TerminalState,
} from './terminal-controller.js';
import {
  renderTerminalFrame,
  type TerminalAccessibilityOptions,
} from './terminal-frame.js';
import { createFixtureWorkspace } from './terminal-fixtures.js';

export interface TerminalAppProperties extends TerminalAccessibilityOptions {
  readonly initialState?: TerminalState | undefined;
  readonly fixtureStatus?: string | undefined;
}

export function TerminalApp(properties: TerminalAppProperties) {
  const { exit } = useApp();
  const dimensions = useWindowSize();
  const [state, setState] = useState<TerminalState>(
    properties.initialState ?? createTerminalState(),
  );
  const workspace = useMemo(
    () =>
      createFixtureWorkspace(
        properties.fixtureStatus,
        state.confirmedClaim ?? undefined,
      ),
    [properties.fixtureStatus, state.confirmedClaim],
  );

  useInput((input, key) => {
    const normalized = normalizeInkInput(input, key, state.screen);
    if (normalized === undefined) {
      return;
    }
    const transition = transitionTerminal(state, normalized);
    if (transition.exitRequested) {
      exit();
      return;
    }
    setState(transition.state);
  });

  const frame = renderTerminalFrame(state, workspace, dimensions, properties);
  return properties.reducedDecoration ? (
    <Text>{frame}</Text>
  ) : (
    <Text color="cyan">{frame}</Text>
  );
}

function normalizeInkInput(
  input: string,
  key: Key,
  screen: TerminalState['screen'],
): TerminalKey | undefined {
  if (
    (key.ctrl && input.toLowerCase() === 'c') ||
    (screen === 'workspace' && input.toLowerCase() === 'q')
  ) {
    return { kind: 'quit' };
  }
  if (input === '?') {
    return { kind: 'help' };
  }
  if (key.return) return { kind: 'enter' };
  if (key.escape) return { kind: 'escape' };
  if (key.backspace || key.delete) return { kind: 'backspace' };
  if (key.upArrow) return { kind: 'up' };
  if (key.downArrow) return { kind: 'down' };
  if (key.leftArrow) return { kind: 'left' };
  if (key.rightArrow) return { kind: 'right' };
  if (key.tab) return { kind: 'tab' };
  if (key.pageUp) return { kind: 'page_up' };
  if (key.pageDown) return { kind: 'page_down' };
  if (key.home) return { kind: 'home' };
  if (key.end) return { kind: 'end' };
  return input.length === 0 ? undefined : { kind: 'text', text: input };
}
