# SourceZero Milestones

**Last updated:** 28 August 2026  
**Current milestone:** M2 — Durable events and local persistence  
**Progress:** 2 of 13 milestones complete

## How to use this file

- This file is the source of truth for implementation order and milestone status.
- Valid statuses are `Complete`, `In progress`, `Next`, `Pending`, and `Blocked`.
- At most one milestone may be `In progress`.
- `Next` identifies the first eligible milestone to pick up when no milestone is in progress.
- A milestone becomes `Complete` only when every completion gate is satisfied and its required verification passes.
- When completing a milestone, update its status, checklist, completion date, and verification evidence in this file. Then mark the first dependency-satisfied pending milestone as `Next`.
- If work changes scope or architecture, update [architecture.md](architecture.md) and this plan in the same change.

## Status summary

| Milestone | Outcome                                                 | Status   |
| --------- | ------------------------------------------------------- | -------- |
| M0        | Product and architecture baseline                       | Complete |
| M1        | Workspace and plugin runtime                            | Complete |
| M2        | Durable events and local persistence                    | Next     |
| M3        | Projections and application services                    | Pending  |
| M4        | Interactive terminal workspace                          | Pending  |
| M5        | Terminal provenance graph                               | Pending  |
| M6        | Harness tool executor and provider seams                | Pending  |
| M7        | Claim framing and investigation lifecycle               | Pending  |
| M8        | Source discovery, retrieval, and extraction             | Pending  |
| M9        | Evidence graph and provenance analysis                  | Pending  |
| M10       | Origin, independence, and mutation findings             | Pending  |
| M11       | Product-complete TUI, replay, cancellation, and exports | Pending  |
| M12       | Evaluation suite and demo readiness                     | Pending  |

## M0 — Product and architecture baseline

**Status:** Complete  
**Completed:** 27 August 2026

### Deliverables

- [x] Product requirements define the MVP, non-goals, users, and acceptance expectations.
- [x] Local-first engine, investigator harness, and full terminal-client direction is established.
- [x] Kernel and plugin boundaries are documented.
- [x] Durable-event, projection, tool, provider, persistence, and TUI architecture is documented.
- [x] Ordered implementation milestones and contributor workflow exist.

### Completion gates

- [x] [product-requirement-doc.md](product-requirement-doc.md), [architecture.md](architecture.md), [milestones.md](milestones.md), and [AGENTS.md](AGENTS.md) agree on the local-first terminal MVP.

### Verification evidence

- Documentation reviewed together for consistent terminology, scope, and cross-links.

## M1 — Workspace and plugin runtime

**Status:** Complete  
**Completed:** 28 August 2026

### Outcome

A strict TypeScript workspace boots a deterministic local plugin composition and a minimal CLI command without loading investigation behavior.

### Deliverables

- [x] Initialize pnpm workspace, TypeScript ESM configuration, linting, formatting, and Vitest.
- [x] Create the initial app and package boundaries from [architecture.md](architecture.md).
- [x] Implement typed service keys and a service registry.
- [x] Implement plugin dependency declarations, startup ordering, and reverse-order disposal.
- [x] Reject duplicate plugin IDs, duplicate service ownership, missing dependencies, and cycles with actionable errors.
- [x] Implement validated local configuration loading without secrets in diagnostics.
- [x] Add a minimal `sourcezero` CLI that boots and disposes the runtime.

### Completion gates

- [x] Strict typecheck, lint, and focused tests pass.
- [x] Tests cover successful composition, every boot rejection, partial-start rollback, and idempotent disposal.
- [x] CLI smoke test boots a fixture composition and exits cleanly.
- [x] No provider SDK, database implementation, or TUI framework leaks into the domain package.

### Verification evidence

- `corepack pnpm verify` — strict TypeScript check, ESLint, Prettier check, and 14 focused Vitest tests passed.
- `corepack pnpm build` — all workspace projects built successfully.
- `node apps/cli/dist/bin.js` — fixture runtime booted, resolved its declared service, disposed, and exited cleanly.

## M2 — Durable events and local persistence

**Status:** Next  
**Depends on:** M1

### Outcome

Investigations have immutable identities, a versioned append-only event vocabulary, a transactional SQLite store, and content-addressed local artifacts.

### Deliverables

- [ ] Define branded investigation, event, source, claim, evidence, relationship, tool-call, and artifact IDs.
- [ ] Define the event envelope and the first investigation lifecycle/configuration events.
- [ ] Implement SQLite migrations, WAL setup, append transactions, reads, listing, and optimistic sequence checks.
- [ ] Implement artifact hashing, bounded writes, atomic placement, reads, and metadata.
- [ ] Add event and artifact schema/version handling.
- [ ] Add redaction rules preventing credentials from entering events, artifacts, or diagnostics.

### Completion gates

- [ ] Concurrent or stale append attempts cannot create duplicate or non-contiguous sequences.
- [ ] Restart tests reload the exact committed event stream.
- [ ] Torn or failed artifact writes do not publish artifact metadata.
- [ ] Temporary-database and temporary-artifact integration tests pass.

### Verification evidence

- Not completed.

## M3 — Projections and application services

**Status:** Pending  
**Depends on:** M2

### Outcome

Pure versioned projections rebuild investigation state, and application services expose consistent commands, snapshots, and live updates to clients.

### Deliverables

- [ ] Implement projection registration, fold, checkpoint, invalidation, and rebuild.
- [ ] Add lifecycle, progress, budget, trace, limitations, source, and graph projection foundations.
- [ ] Implement gap-free observe-from-sequence behavior for local clients.
- [ ] Define client-neutral `InvestigationWorkspaceView` and available-action models.
- [ ] Implement create, list, show, and inspect application services.

### Completion gates

- [ ] Full replay and checkpoint-plus-tail replay produce equivalent views.
- [ ] Projection-version changes invalidate incompatible checkpoints.
- [ ] A subscriber cannot miss events between initial snapshot and live observation.
- [ ] Application services expose no Ink, SQLite-driver, or provider-specific types.

### Verification evidence

- Not completed.

## M4 — Interactive terminal workspace

**Status:** Pending  
**Depends on:** M3

### Outcome

The CLI opens a responsive interactive TUI driven by fixture and replayed investigations before real external providers are connected.

### Deliverables

- [ ] Add Ink-based application lifecycle with safe terminal setup and teardown.
- [ ] Implement Overview, Timeline, Evidence, Limitations, and Trace views against presentation models.
- [ ] Implement tabs, focus, keyboard help, scrolling, resize handling, and narrow-terminal layouts.
- [ ] Implement claim-entry, selection, editing, and confirmation components using fixtures.
- [ ] Add screen-reader and reduced-decoration modes.
- [ ] Add `--plain` and `--json` behavior for non-interactive use.

### Completion gates

- [ ] Fixed-size frame tests cover wide, narrow, empty, running, failed, canceled, and completed states.
- [ ] Keyboard tests cover every primary navigation and confirmation action.
- [ ] Redirected output contains no terminal control sequences.
- [ ] TUI teardown restores terminal state after success, error, and interruption.

### Verification evidence

- Not completed.

## M5 — Terminal provenance graph

**Status:** Pending  
**Depends on:** M4

### Outcome

Users can explore a live provenance graph inside the terminal with evidence-equivalent non-graph access.

### Deliverables

- [ ] Define the positioned-graph and graph-viewport contracts.
- [ ] Add an `elkjs` layout adapter behind the SourceZero layout interface.
- [ ] Implement character-cell node, label, edge, junction, arrow, and clipping rendering.
- [ ] Handle Unicode display width and terminal resizing.
- [ ] Implement selection, panning, semantic density, filters, upstream/descendant highlighting, and duplicate collapse.
- [ ] Implement node/edge evidence details and an adjacency-list alternative.
- [ ] Define explicit cycle and feedback-edge behavior.

### Completion gates

- [ ] Deterministic snapshots cover trees, diamonds, duplicates, multiple origins, cycles, crossings, clipping, and empty graphs.
- [ ] Graph interaction remains responsive at the configured MVP visible-node limit.
- [ ] All material graph facts are available through the evidence table or adjacency view.
- [ ] Graph rendering contains no domain decisions or relationship inference.

### Verification evidence

- Not completed.

## M6 — Harness tool executor and provider seams

**Status:** Pending  
**Depends on:** M2, M3

### Outcome

The harness can invoke validated, cancellable, budgeted tools through explicit model, search, fetch, and extraction provider seams.

### Deliverables

- [ ] Implement typed tool registration and canonical JSON input/output contracts.
- [ ] Implement validation, call identity, timeout, retry, cancellation, event recording, and normalized failures.
- [ ] Define model, search, fetch, and extraction provider interfaces and registries.
- [ ] Implement explicit provider selection and ambiguity failures.
- [ ] Add deterministic fixture and replay providers for every seam.
- [ ] Add first real model provider adapter.

### Completion gates

- [ ] Contract tests run against every provider implementation.
- [ ] Cancellation stops scheduling and reaches every active provider call.
- [ ] Invalid model/tool/provider values cannot create domain events.
- [ ] Retry and timeout accounting is durable and deterministic.
- [ ] Replayed provider results require no network or model call.

### Verification evidence

- Not completed.

## M7 — Claim framing and investigation lifecycle

**Status:** Pending  
**Depends on:** M4, M6

### Outcome

A user can create an investigation from a claim or URL, confirm one precise claim, and start a bounded durable run.

### Deliverables

- [ ] Implement manual claim input, normalization proposal, editing, and explicit confirmation.
- [ ] Implement URL input, initial retrieval, and up to five proposed claims.
- [ ] Preserve original input and page-derived context.
- [ ] Implement durable lifecycle transitions and legal-action checks.
- [ ] Require restart or branch for reframing after substantive work.
- [ ] Display framing feedback and structured failures in TUI, plain, and JSON modes.

### Completion gates

- [ ] No investigation work beyond framing begins before confirmation.
- [ ] Confirmation and later changes are additive durable events.
- [ ] Claim and URL happy paths and failure paths pass end-to-end fixture tests.
- [ ] The normal framing target meets the PRD latency target under fixture providers.

### Verification evidence

- Not completed.

## M8 — Source discovery, retrieval, and extraction

**Status:** Pending  
**Depends on:** M6, M7

### Outcome

The investigator can discover, safely retrieve, parse, and traverse relevant public webpages within explicit budgets.

### Deliverables

- [ ] Implement the first real search provider and source-discovery tool.
- [ ] Implement SSRF-resistant bounded HTTP retrieval and redirect inspection.
- [ ] Implement readable-text, metadata, citation, hyperlink, named-source, and exact-phrase lead extraction.
- [ ] Add bounded browser fallback only where static retrieval is inadequate.
- [ ] Normalize candidate URLs while preserving redirect and discovery history.
- [ ] Record failed, blocked, duplicate, and budget-unfollowed leads as limitations.

### Completion gates

- [ ] SSRF, redirect, protocol, DNS/address, timeout, byte, character, and content-type tests pass.
- [ ] Every query and followed lead is causally traceable.
- [ ] Retrieval artifacts and evidence locations survive replay.
- [ ] Search, source, traversal-depth, retry, time, and cost budgets are enforced.

### Verification evidence

- Not completed.

## M9 — Evidence graph and provenance analysis

**Status:** Pending  
**Depends on:** M8

### Outcome

Retrieved sources become an evidence-backed graph with source classifications, duplicate groups, and validated relationships.

### Deliverables

- [ ] Implement relevant-passage extraction with exact source text and recoverable locations.
- [ ] Implement source identity and publication-date candidate records.
- [ ] Implement deterministic exact duplicate hashing.
- [ ] Implement evaluated near-duplicate and syndication signals.
- [ ] Implement primary, secondary, derivative, and unresolved source classification proposals.
- [ ] Implement evidence-backed provenance relationship commands and validation.
- [ ] Present confidence explanations and unresolved classifications as first-class results.

### Completion gates

- [ ] Every accepted model-created relationship cites evidence and a creating event.
- [ ] Invalid node and edge references are rejected deterministically.
- [ ] Duplicate thresholds and evidence are visible and regression-tested.
- [ ] Synthetic lineage fixtures replay to the expected graph.

### Verification evidence

- Not completed.

## M10 — Origin, independence, and mutation findings

**Status:** Pending  
**Depends on:** M9

### Outcome

SourceZero derives its differentiating findings: earliest located candidates, likely independent support, and material claim mutations.

### Deliverables

- [ ] Implement deterministic chronology with publication-date uncertainty.
- [ ] Implement competing earliest-located origin candidates and explanations.
- [ ] Implement apparent, independent, derivative, contradicting, and unresolved counts.
- [ ] Implement claim-variant extraction and chronological lineage.
- [ ] Implement mutation dimensions from the PRD with evidence and explanations.
- [ ] Implement freshness summary signals for availability, corrections, and supersession.

### Completion gates

- [ ] Findings never use absolute-first or exhaustive language.
- [ ] Independence is not presented as correctness.
- [ ] Every material finding resolves to graph elements and exact evidence.
- [ ] Synthetic origin, independence, syndication, ambiguity, and mutation cases meet expected outputs.

### Verification evidence

- Not completed.

## M11 — Product-complete TUI, replay, cancellation, and exports

**Status:** Pending  
**Depends on:** M5, M10

### Outcome

The terminal product satisfies every P0 interaction, control, inspection, replay, and export requirement.

### Deliverables

- [ ] Connect all live harness stages and projections to the TUI.
- [ ] Complete Overview, Graph, Timeline, Evidence, Limitations, and Trace parity.
- [ ] Implement interactive cancellation and partial-result inspection.
- [ ] Implement process-interruption recovery policy and replay commands.
- [ ] Implement Markdown, versioned JSON, and event-trace exports.
- [ ] Implement list, show, export, replay, and cancel command exit-code behavior.
- [ ] Polish terminal accessibility, help, empty states, errors, and responsive layouts.

### Completion gates

- [ ] A fixture investigation can be confirmed, watched, explored, canceled, replayed, and exported entirely in terminal.
- [ ] Live and replayed authoritative projections are equivalent.
- [ ] CLI exit codes distinguish success, cancellation, budget exhaustion, configuration failure, and terminal failure.
- [ ] JSON mode is stable, documented, and contains no presentation noise.
- [ ] All relevant P0 PRD acceptance criteria are traced to passing tests.

### Verification evidence

- Not completed.

## M12 — Evaluation suite and demo readiness

**Status:** Pending  
**Depends on:** M11

### Outcome

SourceZero is measurable, regression-tested, and ready for the documented portfolio demonstration.

### Deliverables

- [ ] Build at least 25 evaluation claims covering the PRD categories.
- [ ] Include deterministic synthetic citation networks and documented public cases.
- [ ] Implement quality, unsupported-finding, citation-resolution, tool-use, latency, token, and cost metrics.
- [ ] Implement regression comparison for prompt, model, tool, threshold, and stopping-policy changes.
- [ ] Tune default budgets and graph limits from measured evidence.
- [ ] Document and validate at least two synthetic and three public demonstration cases.
- [ ] Complete the primary citation-cascade portfolio demo.

### Completion gates

- [ ] The evaluation report includes every core PRD metric or a documented reason for deferral.
- [ ] Required synthetic and public demo cases pass documented expectations.
- [ ] Cancellation, replay, export, and partial-failure cases pass regression tests.
- [ ] Quality thresholds hold under the selected default time and cost budgets.
- [ ] The MVP success criteria in the PRD are demonstrably satisfied.

### Verification evidence

- Not completed.
