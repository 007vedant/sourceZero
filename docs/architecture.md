# SourceZero Architecture

**Status:** Accepted baseline for implementation  
**Date:** 28 August 2026  
**Scope:** Local-first engine, investigator harness, interactive terminal application, and CLI automation surfaces  
**Product requirements:** [product-requirement-doc.md](product-requirement-doc.md)  
**Delivery plan:** [milestones.md](milestones.md)

## 1. Purpose

This document defines the initial technical architecture for SourceZero. The first product surface is a local terminal application backed by the same engine and durable model that a future website will use. The terminal experience is not a reduced developer interface: it must support claim confirmation, live investigation progress, provenance-graph exploration, mutation timelines, evidence inspection, limitations, traces, cancellation, replay, and exports.

The architecture borrows principles from mature plugin-based agent harnesses without borrowing their code or reproducing a general-purpose plugin framework. SourceZero keeps a small integrity-critical kernel and makes providers, tools, projections, policies, and exporters replaceable.

## 2. Architectural principles

1. **One confirmed claim is the unit of work.** Every investigation is scoped to a user-confirmed claim.
2. **The event log is authoritative.** Graphs, findings, progress, reports, and UI state are projections of durable facts.
3. **Model-visible means durable.** Every input that can materially affect model output must be reconstructable from events and immutable artifacts.
4. **Models propose; the kernel validates.** A model cannot directly modify graph tables, budgets, investigation status, or event history.
5. **Deterministic analysis owns deterministic facts.** Counts, hashes, traversal, dates, graph validation, configured similarity calculations, and budget arithmetic are code-owned.
6. **Capabilities have definition, provider, and consumer roles.** Provider-specific fields do not leak into the engine's domain or harness contracts.
7. **Registrations have lifecycle owners.** Every plugin contribution is reversible and disposed in a defined order.
8. **Provider selection is explicit.** Multiple usable providers without an explicit selection are a configuration error, never an order-dependent choice.
9. **Cancellation is cooperative and end-to-end.** Every external or potentially long-running operation receives an `AbortSignal`.
10. **Partial results remain valid.** Cancellation, budget exhaustion, and individual source failures produce inspectable partial investigations with limitations.
11. **Terminal and web are clients of the same product model.** They share events, projections, view models, and legal actions, not rendering components.
12. **Local operation comes first.** The initial runtime requires no hosted API, PostgreSQL, Redis, object storage service, or web server.

## 3. System overview

```text
Terminal input
     │
     ▼
CLI command and TUI controller
     │ commands                         projection updates
     ▼                                           ▲
SourceZero engine ───────────────────────────────┤
     ├── application services                    │
     ├── investigator harness                    │
     │     ├── model loop and context            │
     │     └── tool executor ── consumers ── providers
     ├── domain and graph rules                  │
     ├── SQLite event store and artifacts        │
     └── deterministic projections               │
                                  │
                                  ▼
                         product presentation model
```

The engine runs in the CLI process initially. UI rendering is an observer of committed engine state and does not own the investigation task. A rendering failure must not corrupt the investigation log.

### 3.1 Engine and harness terminology

`Engine` is the canonical name for the complete headless SourceZero product core:

```text
SourceZero engine
├── Investigator harness
├── Domain and graph rules
├── Event store and projections
└── Application services
```

`Harness` is the canonical name for SourceZero's agentic orchestration subsystem. It owns all of the following as one cohesive lifecycle:

- Model interaction loop
- Context construction
- Tool and plugin execution coordination
- Budget enforcement and stopping policy
- Cancellation, timeouts, and retries

Use `harness` when referring specifically to these orchestration responsibilities. Use `engine` when referring to the complete headless core that contains the harness, domain rules, persistence and projections, and application services. Neither term is a synonym for the other.

## 4. Technology baseline

| Concern                          | Initial choice                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Language and runtime             | TypeScript on Node.js, ESM                                                         |
| Workspace                        | pnpm workspaces; add Turborepo only when task orchestration warrants it            |
| Local database                   | SQLite in WAL mode through Node.js `node:sqlite`                                   |
| Database access                  | Drizzle for schema and migrations; explicit SQL for critical event transactions    |
| Runtime validation               | Zod at configuration, model, tool, persistence, plugin, and wire boundaries        |
| Terminal UI                      | React with Ink                                                                     |
| Graph layout                     | `elkjs`, behind a SourceZero layout interface                                      |
| CLI parsing                      | Commander.js                                                                       |
| Unit and integration tests       | Vitest                                                                             |
| Browser-level retrieval fallback | Playwright only when bounded HTTP retrieval and static extraction are insufficient |
| Logging                          | Structured local logs with secret and content redaction policies                   |

Provider choices for models and search remain configuration decisions. The first implementation may ship one provider for each capability while retaining provider-neutral internal interfaces.

## 5. Repository organization

The initial workspace should use a small number of packages. Modules may split into new packages only when they have independent consumers, providers, or release constraints.

```text
apps/
  cli/                  command parsing, TUI, plain output, JSON output

packages/
  engine/
    domain/             ids, events, graph commands, investigation lifecycle
    runtime/            plugin lifecycle, service registry, configuration
    harness/            model loop, context, tool/plugin execution, budgets,
                        stopping policy, cancellation, timeouts, and retries
    persistence/        SQLite event store, projections, artifact store
    application/        commands, queries, observation, workspace assembly
  providers/            model, search, fetch, and extraction providers
  presentation/         client-neutral workspace view models and actions
  exports/              Markdown, JSON, and event-trace exporters
  evaluation/           fixtures, replay providers, scorers, regressions
```

Dependency direction is inward toward domain contracts:

```text
apps/cli ── presentation
   │
   ▼
engine/application
   ├── engine/harness ── capability definitions ◀── providers
   ├── engine/domain
   └── engine/persistence
```

The engine's domain package must not import the CLI, Ink, provider SDKs, SQLite adapters, or future web code. The engine exposes its supported operations through application services rather than allowing clients to reach into the harness or persistence implementation.

## 6. Integrity core and plugin boundary

### 6.1 Non-replaceable behavior

The following mechanisms protect auditability and are not replaceable plugins. The harness core owns orchestration invariants; the domain core owns durable investigation and graph invariants.

Harness core:

- Model-loop state transitions
- Context-construction provenance
- Budget ledger and limit enforcement
- Cancellation ownership
- Tool-call identity, execution pipeline, and result recording
- Timeout, retry, and stopping-policy enforcement

Domain core:

- Event envelope, schema version, and per-investigation sequence rules
- Atomic event append and optimistic concurrency
- Investigation lifecycle state machine
- Graph identity and reference validation
- Graph command validation
- Replay ordering and projection consistency
- Secret-redaction invariants

### 6.2 Plugin-owned capabilities

Plugins may contribute:

- Model providers
- Search providers
- Fetch providers
- Content extraction strategies
- Investigation tools
- Deterministic analyzers and classifiers
- Projection units
- Export formats
- Retry, timeout, and stopping policies within harness-core-enforced bounds

### 6.3 Plugin lifecycle

The SourceZero runtime uses typed service keys rather than stringly typed service lookup.

```ts
interface Plugin {
  readonly id: string;
  readonly requires?: readonly ServiceKey<unknown>[];
  setup(context: PluginContext): void | Disposable | Promise<void | Disposable>;
}

interface PluginContext {
  registerService<T>(key: ServiceKey<T>, service: T): Disposable;
  registerTool<I, O>(tool: ToolDefinition<I, O>): Disposable;
  registerProjection<S, V>(projection: Projection<S, V>): Disposable;
  onLiveEvent<T>(
    type: LiveEventType<T>,
    listener: (event: T) => void,
  ): Disposable;
}
```

Boot validates duplicate plugin IDs, missing services, duplicate service ownership, dependency cycles, and configuration before beginning an investigation. Plugins start in dependency order. Failed boot disposes already-started plugins in reverse order. A registration never outlives the plugin that owns it.

Initial composition is explicit TypeScript assembled by the CLI. Dynamic installation, hot reload, remote plugins, profiles, and a general YAML module loader are deferred until there is a concrete external-plugin use case.

## 7. Capability seams

Each swappable capability has three roles:

```text
Service definition → one or more providers → harness or tool consumer
```

Initial seams are:

| Capability       | Definition                                                     | Example providers                                | Consumer                         |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------ | -------------------------------- |
| Model            | Normalized request, structured response, usage, streaming      | First hosted model adapter; replay adapter       | Investigator decision service    |
| Search           | Query, result limit, normalized candidates                     | First web-search adapter; fixture/replay adapter | Source-discovery tool            |
| Fetch            | Public URL request and bounded response                        | Safe HTTP provider; fixture/replay provider      | Source-retrieval tool            |
| Extraction       | Retrieved artifact to readable content and metadata candidates | Static DOM/Readability; bounded browser fallback | Extraction tool                  |
| Persistence      | Append, read, list, and replay events                          | SQLite                                           | Application services             |
| Artifact storage | Content-addressed immutable payloads                           | Local filesystem                                 | Retrieval and evidence recording |

A capability runtime resolves the configured provider at execution time. With no configured ID, exactly one usable provider may be selected automatically. Zero or multiple usable providers fail with structured configuration errors.

## 8. Investigation events

### 8.1 Event envelope

Every durable event contains at least:

```ts
interface InvestigationEvent<TType, TData> {
  readonly investigationId: InvestigationId;
  readonly sequence: number;
  readonly type: TType;
  readonly occurredAt: string;
  readonly schemaVersion: number;
  readonly producer: ProducerIdentity;
  readonly causationId?: EventId;
  readonly correlationId?: string;
  readonly data: TData;
}
```

IDs crossing persistence or provider boundaries are branded domain types. Timestamps are recorded in UTC ISO-8601 form. Events are immutable after append.

### 8.2 Event families

The initial vocabulary will include families for:

- Investigation creation, configuration, status, cancellation, and completion
- Original input, proposed claims, confirmation, reframing, and branching
- Model requests, responses, usage, and normalized failures
- Tool requests, starts, results, retries, and failures
- Search queries and discovered candidate leads
- Retrieval attempts, redirects, artifacts, metadata, and failures
- Sources, claim variants, evidence excerpts, and date candidates
- Duplicate groups and provenance relationships
- Classification proposals, accepted classifications, and supersessions
- Budget consumption and exhaustion
- Findings, limitations, and export creation

Large retrieved bodies and provider payloads do not live inline in the event table. Events reference immutable artifacts by content hash and record the bounded facts needed for replay.

### 8.3 Durable and live events

Durable events record facts needed for replay, findings, trace, or model reconstruction. Live events support local rendering and operational coordination, such as repaint requests or transient diagnostics. A live event cannot be the sole record of a material decision.

## 9. Persistence and artifacts

### 9.1 SQLite

SQLite is the initial local system of record. Conceptual tables include:

- `investigations`
- `investigation_events`
- `projection_checkpoints`
- `artifacts`
- optional query projections for sources, claims, evidence, and relationships
- `schema_migrations`

M2 selects the Node.js `node:sqlite` driver. It is available in the Node 22.5 runtime baseline, avoids a separately compiled native addon, and has a supported Drizzle adapter. Drizzle owns schema declarations and migration generation/application; the contiguous event append remains explicit SQL inside an immediate transaction.

`investigation_events` uses a unique `(investigation_id, sequence)` constraint. An append transaction verifies the expected previous sequence, inserts one or more events, and updates investigation metadata atomically. Projection tables are rebuildable and never outrank the event log.

WAL mode supports responsive reads while an investigation appends events. Database migrations and durable event-format versions are distinct concerns.

### 9.2 Artifact store

Large immutable content is stored below a SourceZero data directory using content-addressed paths. The database records hash, media type, byte length, creation time, retention class, and relative location. Writes use a temporary file, content verification, and atomic rename.

Artifacts may include:

- Raw bounded HTTP response bodies when retention policy permits
- Extracted readable text
- Normalized metadata documents
- Model/provider payloads that are safe and necessary to retain
- Exported reports

Secrets, cookies, authorization headers, and unrestricted provider payloads must never be persisted.

## 10. Projections and presentation

Projection units are pure, synchronous folds:

```ts
interface Projection<S, V> {
  readonly id: string;
  readonly version: number;
  init(): S;
  apply(state: S, event: InvestigationEvent): S;
  view(state: S): V;
}
```

Returning the previous state reference indicates no change. Projection checkpoints include projection ID, version, investigation ID, last applied sequence, and plain JSON state. A version mismatch discards the checkpoint and rebuilds from events.

Initial projections include:

- Investigation status and current stage
- Budget usage
- Source catalog
- Open and unexplored leads
- Provenance graph
- Mutation timeline
- Evidence table
- Findings readiness and overview
- Limitations
- Technical trace

Client-neutral presentation models sit above domain projections:

```ts
interface InvestigationWorkspaceView {
  overview: OverviewView;
  progress: ProgressView;
  graph: ProvenanceGraphView;
  timeline: MutationTimelineView;
  evidence: EvidenceTableView;
  limitations: LimitationsView;
  trace: TraceView;
  availableActions: readonly InvestigationAction[];
}
```

The terminal and future website must render the same facts and legal actions. They may use different layouts and interaction techniques.

## 11. Investigator harness

The initial harness runs one investigator loop. Additional agents are excluded unless evaluation demonstrates a material quality improvement.

At each iteration the harness:

1. Reads a consistent projection snapshot.
2. Evaluates open uncertainties, leads, required result sections, and remaining budgets.
3. Builds model context exclusively from durable state and referenced artifacts.
4. Requests a structured decision from the configured model provider.
5. Validates the proposed action.
6. Executes a typed tool or emits a validated domain command.
7. Commits resulting events.
8. Re-evaluates deterministic stopping conditions.

The stopping policy considers promising leads, recent discovery yield, evidence coverage, unresolved material classifications, required output readiness, budgets, and cancellation. An unconstrained model decision cannot be the only stopping condition.

## 12. Tool execution

The harness's tool-execution subsystem exposes validated canonical JSON values:

```ts
interface ToolDefinition<I, O> {
  readonly name: string;
  readonly inputSchema: ZodType<I>;
  readonly outputSchema: ZodType<O>;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  execute(input: I, context: ToolExecutionContext): Promise<O>;
}
```

The harness's central executor owns this pipeline:

```text
validate input
  → check cancellation and budgets
  → record requested/start events
  → apply timeout and retry policy
  → run provider or deterministic body
  → validate canonical output
  → store required artifacts
  → record result/failure and budget events
  → return model-facing projection
```

Tool bodies do not append arbitrary events. They return canonical values or domain command proposals to an application service that validates and commits them. Timeouts and cancellation never detach uncontrolled same-process work.

## 13. Graph integrity

Models and tools propose commands rather than writing projection tables:

```ts
type GraphCommand =
  | AddSource
  | AddClaimVariant
  | RecordEvidence
  | AddDateCandidate
  | ProposeRelationship
  | ResolveRelationship
  | GroupDuplicates
  | SupersedeClassification;
```

The command handler validates referenced identities, allowed node and edge combinations, supporting evidence, confidence vocabulary, event causality, and supersession rules. Accepted commands produce additive events. Corrections and reclassifications never delete historical machine decisions.

## 14. Terminal application

### 14.1 Product parity

The interactive CLI is the reference client for the MVP and includes:

- Claim or URL entry
- Proposed-claim selection and editing
- Explicit claim confirmation
- Live stage progress
- Overview metrics and findings
- Interactive provenance graph
- Mutation timeline
- Sortable and inspectable evidence view
- Limitations and inaccessible-source view
- Expandable technical trace
- Cancellation and partial results
- Replay and exports

### 14.2 TUI views

The workspace uses responsive tabs or panes:

- Overview
- Graph
- Timeline
- Evidence
- Limitations
- Trace

Narrow terminals switch to a single-pane layout. Keyboard navigation is primary. Color is supplemental. A screen-reader mode and adjacency-list graph representation provide equivalent access to material findings.

### 14.3 Terminal graph renderer

Graph layout and rendering are separate:

```text
ProvenanceGraphView
  → layout adapter (`elkjs` initially)
  → platform-neutral positioned graph
  → terminal character-cell renderer
  → Ink component
```

The renderer owns Unicode cell width, node boxes, edge routing, junction glyphs, clipping, selection, viewport movement, collapsed groups, and semantic density. It supports upstream and descendant highlighting and opens evidence for selected nodes or edges. Cycles are handled explicitly through strongly connected components or feedback-edge routing rather than assuming a DAG.

### 14.4 Output modes

```text
Interactive TTY          full TUI
--plain                  append-only human-readable progress
--json                   machine-readable output without ANSI control codes
export markdown|json     stable completed or partial artifact
export events            durable trace
```

Redirected output defaults to plain mode unless the user explicitly requests JSON. The CLI must never mix decorative output into JSON mode.

## 15. Cancellation, recovery, and replay

The harness owns one cancellation controller per running investigation. After cancellation is acknowledged, the harness schedules no new tool work. Started operations settle or are safely abandoned according to explicit provider policy, and the terminal continues to show committed partial results.

Each external call receives the investigation signal combined with its tool deadline. Cancellation and timeout remain distinguishable structured outcomes.

On process restart, the application inspects the final durable event and lifecycle projection. An interrupted investigation is never silently called complete. Recovery policy may close it as interrupted or resume it from committed state, but either action appends a new event. Replay rebuilds projections without repeating model or external tool calls.

## 16. Retrieval security

All retrieved content is untrusted data and cannot supply instructions to the runtime.

The fetch capability must:

- Accept only public HTTP and HTTPS URLs
- Reject credentials embedded in URLs
- Resolve and reject loopback, private, link-local, multicast, reserved, and cloud metadata destinations
- Revalidate DNS and IP policy for every redirect
- Bound URL length, redirects, response bytes, decoded characters, and time
- Restrict methods and outbound headers
- Avoid ambient cookies and credentials
- Validate content type before parsing
- Isolate browser-rendering fallback and restrict its network requests
- Record structured failures and redirect history

Application-layer URL validation does not replace operating-system or container egress restrictions in a future hosted deployment.

## 17. Configuration and secrets

Configuration is validated once at boot and resolved into an immutable investigation policy recorded when an investigation is created. Environment-specific defaults are owned by the component that defines them.

The local CLI may read a documented configuration file and environment variables. Secret values are resolved by providers at execution time through credential references. Configuration dumps, events, logs, artifacts, prompts, and exports must redact secret values.

## 18. Testing and evaluation

Testing follows the architecture boundaries:

- Unit tests for domain commands, state machines, budget arithmetic, stopping rules, graph analysis, and projections
- Contract tests for every provider implementation
- Integration tests using a real temporary SQLite database and artifact directory
- Fixture and replay providers for deterministic harness trajectories
- TUI frame tests at fixed terminal dimensions
- Keyboard interaction tests for navigation, confirmation, cancellation, and export
- Property tests for event sequencing, replay equivalence, graph references, and character-cell rendering where useful
- Security tests for SSRF classes, redirects, size limits, malicious HTML, and prompt injection
- Evaluation datasets and metrics required by the PRD

An investigation produced live and the same investigation replayed from its event log must yield equivalent authoritative projections.

## 19. Future website transition

The website will be another client of the engine's application services and presentation models. Hosting will introduce an API transport, authentication, remote job execution, PostgreSQL or another hosted event store, object storage, and streaming projection updates. None of those concerns may be required by the engine's domain, harness, tool definitions, or presentation contracts.

The local SQLite event format and exported JSON format are versioned independently. Moving to hosted storage should require a persistence adapter, not an investigator rewrite.

## 20. Deferred decisions

The following choices will be made in the milestone that first needs them:

- First model and search providers
- Final local data-directory convention on each operating system
- Retention policy for raw retrieved content
- Confidence vocabulary and calibration representation
- Near-duplicate algorithms and thresholds
- Default budgets and stopping thresholds
- Maximum retained and simultaneously visible graph sizes
- Whether interrupted investigations initially support resume or only explicit restart

Each decision must be evaluated against replayability, inspectability, cost, security, and the PRD rather than selected solely for implementation convenience.
