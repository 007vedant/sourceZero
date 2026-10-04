/**
 * Adapts Ink input, resize, and accessibility hooks to the pure terminal workspace model.
 */

import {
  ElkGraphLayoutAdapter,
  type InvestigationWorkspaceView,
  type PositionedGraph,
} from '@sourcezero/presentation';
import { Text, useApp, useInput, useWindowSize, type Key } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import stringWidth from 'string-width';

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
  readonly initialWorkspace?: InvestigationWorkspaceView | undefined;
  readonly framingActions?: TerminalFramingActions | undefined;
}

export interface TerminalFramingActions {
  edit(
    workspace: InvestigationWorkspaceView,
    wording: string,
  ): InvestigationWorkspaceView | Promise<InvestigationWorkspaceView>;
  confirm(
    workspace: InvestigationWorkspaceView,
    claimId: string,
    wording: string,
  ): InvestigationWorkspaceView | Promise<InvestigationWorkspaceView>;
}

const graphLayout = new ElkGraphLayoutAdapter();

export function TerminalApp(properties: TerminalAppProperties) {
  const { exit } = useApp();
  const dimensions = useWindowSize();
  const [state, setState] = useState<TerminalState>(
    properties.initialState ?? initialStateFor(properties.initialWorkspace),
  );
  const [liveWorkspace, setLiveWorkspace] = useState<
    InvestigationWorkspaceView | undefined
  >(properties.initialWorkspace);
  const [positionedGraph, setPositionedGraph] = useState<PositionedGraph>();
  const [graphLayoutError, setGraphLayoutError] = useState<string>();
  const fixtureWorkspace = useMemo(
    () =>
      createFixtureWorkspace(
        properties.fixtureStatus,
        state.confirmedClaim ?? undefined,
      ),
    [properties.fixtureStatus, state.confirmedClaim],
  );
  const workspace = liveWorkspace ?? fixtureWorkspace;

  useEffect(() => {
    const controller = new AbortController();
    setPositionedGraph(undefined);
    setGraphLayoutError(undefined);
    void graphLayout
      .layout(
        workspace.graph,
        {
          direction: 'right',
          nodeHeight: 3,
          measureNodeWidth: (node) =>
            Math.max(12, Math.min(34, stringWidth(node.label) + 4)),
        },
        controller.signal,
      )
      .then(setPositionedGraph)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setGraphLayoutError(
            error instanceof Error ? error.message : 'Graph layout failed.',
          );
        }
      });
    return () => controller.abort();
  }, [workspace]);

  useInput((input, key) => {
    const normalized = normalizeInkInput(input, key, state.screen);
    if (normalized === undefined) {
      return;
    }
    if (state.busy) return;
    if (
      properties.framingActions !== undefined &&
      state.screen === 'claim_editing' &&
      normalized.kind === 'enter' &&
      state.input.trim().length > 0
    ) {
      setState({ ...state, busy: true, framingFeedback: 'Saving claim edit…' });
      void Promise.resolve(
        properties.framingActions.edit(workspace, state.input.trim()),
      )
        .then((updated) => {
          setLiveWorkspace(updated);
          setState({
            ...state,
            screen: 'claim_confirmation',
            input: updated.framing.workingClaim?.wording ?? state.input.trim(),
            proposals: updated.framing.proposals.map(
              (proposal) => proposal.wording,
            ),
            busy: false,
            framingFeedback: 'Claim edit recorded durably.',
          });
        })
        .catch((error: unknown) => {
          setState({
            ...state,
            busy: false,
            framingFeedback:
              error instanceof Error ? error.message : 'Claim edit failed.',
          });
        });
      return;
    }
    if (
      properties.framingActions !== undefined &&
      state.screen === 'claim_confirmation' &&
      normalized.kind === 'text' &&
      normalized.text.toLowerCase() === 'y'
    ) {
      const proposal = workspace.framing.proposals.find(
        (candidate) => candidate.wording === state.input,
      );
      if (proposal === undefined) {
        setState({
          ...state,
          framingFeedback:
            'Select or save a durable proposal before confirmation.',
        });
        return;
      }
      setState({ ...state, busy: true, framingFeedback: 'Confirming claim…' });
      void Promise.resolve(
        properties.framingActions.confirm(
          workspace,
          proposal.claimId,
          proposal.wording,
        ),
      )
        .then((updated) => {
          setLiveWorkspace(updated);
          setState({
            ...state,
            screen: 'workspace',
            confirmedClaim: proposal.wording,
            focus: 'tabs',
            scrollOffset: 0,
            busy: false,
            framingFeedback: 'Claim confirmed; bounded run started.',
          });
        })
        .catch((error: unknown) => {
          setState({
            ...state,
            busy: false,
            framingFeedback:
              error instanceof Error
                ? error.message
                : 'Claim confirmation failed.',
          });
        });
      return;
    }
    const transition = transitionTerminal(state, normalized, workspace.graph);
    if (transition.exitRequested) {
      exit();
      return;
    }
    setState(transition.state);
  });

  const frame = renderTerminalFrame(
    state,
    workspace,
    dimensions,
    properties,
    positionedGraph,
    graphLayoutError,
  );
  return properties.reducedDecoration ? (
    <Text>{frame}</Text>
  ) : (
    <Text color="cyan">{frame}</Text>
  );
}

function initialStateFor(
  workspace: InvestigationWorkspaceView | undefined,
): TerminalState {
  const base = createTerminalState();
  if (workspace === undefined) return base;
  const proposals = workspace.framing.proposals.map(
    (proposal) => proposal.wording,
  );
  if (workspace.overview.status === 'awaiting_confirmation') {
    const multiple = proposals.length > 1;
    return {
      ...base,
      screen: multiple ? 'claim_selection' : 'claim_confirmation',
      input: workspace.framing.workingClaim?.wording ?? proposals[0] ?? '',
      proposals,
      framingFeedback: 'Framing result is durable and awaiting confirmation.',
    };
  }
  return {
    ...base,
    screen: 'workspace',
    ...(workspace.framing.confirmedClaim === undefined
      ? {}
      : { confirmedClaim: workspace.framing.confirmedClaim.wording }),
  };
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
