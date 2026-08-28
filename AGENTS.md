# SourceZero Contributor Instructions

## Read before working

Read these files in order before making substantive changes:

1. [product-requirement-doc.md](product-requirement-doc.md) for product requirements and non-goals.
2. [architecture.md](architecture.md) for system boundaries and technical decisions.
3. [milestones.md](milestones.md) for current status, implementation order, and completion gates.

The PRD is authoritative for product behavior. Architecture is authoritative for dependency direction and integrity boundaries. Milestones are authoritative for implementation sequence and progress.

## Milestone workflow

- Before beginning implementation, locate the milestone that contains the requested work.
- If the user does not name a scope, pick up the milestone marked `Next` in [milestones.md](milestones.md). Do not select work from memory or invent an untracked milestone.
- Change the selected milestone to `In progress` before substantive implementation and update the file's `Current milestone` field. At most one milestone may be in progress.
- Keep changes within the current milestone unless the user explicitly requests broader work or a prerequisite must be corrected. Record prerequisite or scope changes in the milestone file.
- A milestone is complete only when all its deliverables and completion gates are satisfied. Passing a subset of tests or exhausting available time is not completion.
- After the work is done, always update [milestones.md](milestones.md): check completed items, mark the milestone `Complete`, record its completion date and verification evidence, update total progress, and promote the first dependency-satisfied `Pending` milestone to `Next`.
- After completing a milestone, pick up subsequent project work from the newly marked `Next` milestone. Do not silently begin it when the current user request ends at the completed milestone.
- If work is blocked, mark the milestone `Blocked` only with a concrete reason and retain unchecked completion gates. Never mark blocked work complete.
- Documentation-only maintenance that does not satisfy a milestone should update relevant checklist wording or evidence but must not advance milestone status.

## Product and architecture invariants

- One user-confirmed claim is the unit of investigation.
- The durable investigation event log is authoritative. Projection tables, caches, reports, and UI state are rebuildable.
- Anything model-visible or materially affecting a finding must be reconstructable from durable events and referenced immutable artifacts.
- Models and tools propose typed domain commands. Only kernel-owned handlers validate commands and append graph-changing events.
- Never silently overwrite or delete historical classifications, relationships, corrections, or events. Supersede them additively.
- Deterministic facts and checks belong in code, not model prompts.
- `Engine` is the canonical name for the complete headless core: investigator harness, domain and graph rules, event store and projections, and application services.
- `Harness` is the engine subsystem that owns model interaction, context construction, tool/plugin execution, budgets and stopping policy, cancellation, timeouts, and retries. Use `harness` for those responsibilities and `engine` only for the complete core; the terms are not synonyms.
- Provider implementations stay behind capability definitions. Provider-specific request and response types must not leak into engine domain or harness contracts.
- Provider selection is explicit. Multiple usable providers without a configured selection must fail clearly.
- Every plugin registration has a lifecycle owner and disposer. Failed startup rolls back already-started plugins in reverse order.
- The CLI/TUI is a complete product client. New P0 product behavior must account for interactive terminal, plain, and JSON modes where applicable.
- The terminal and future web client share presentation models and legal actions, not renderer-specific components.
- Keep the initial system local-first. Do not introduce hosted services, a web server, PostgreSQL, Redis, or remote job infrastructure without an explicit milestone or user decision.

## TypeScript rules

- Use TypeScript with strict checking and ESM modules.
- Avoid `any`. When an external boundary yields `unknown`, validate or narrow it before use.
- Use branded types for durable and cross-boundary identifiers.
- Use discriminated unions and exhaustive switches for closed domain vocabularies.
- Validate configuration, model output, tool input/output, provider responses, persistence data, plugin boundaries, and exported formats at runtime.
- Trust statically typed private same-process calls; do not add redundant runtime validation inside already-validated internal paths.
- Keep domain modules free of UI frameworks, database drivers, provider SDKs, and process-global configuration.
- Resolve defaults in the component that owns the decision and persist the resolved investigation policy.
- Prefer explicit dependencies and constructor or service-key injection over global singletons.
- Keep functions and modules focused. Split by ownership and independent consumer needs, not arbitrary line counts.
- Comments explain contracts, invariants, security constraints, and non-obvious failure behavior; do not narrate obvious code.

## Events, persistence, and projections

- Events are immutable, versioned, losslessly serializable, and contiguous per investigation.
- Append events and update required investigation metadata atomically.
- Large content belongs in the content-addressed artifact store, referenced by durable events.
- Never persist credentials, cookies, authorization headers, or unredacted provider secrets.
- Projection transitions are pure and synchronous. A projection uninterested in an event returns the previous state reference.
- Projection checkpoints are disposable optimization data and include a projection version and event watermark.
- Replay must not repeat model, search, retrieval, or other external calls.
- A live investigation and replay of its committed log must produce equivalent authoritative projections.

## Tools, providers, and cancellation

- Tools have validated canonical JSON inputs and outputs. Presentation text is derived from canonical values.
- The harness's central executor owns call identity, validation, timeouts, retries, cancellation checks, result normalization, event recording, and budget accounting.
- Every long-running or external operation accepts and observes an `AbortSignal`.
- Once cancellation is acknowledged, schedule no new tool work. Settle or safely terminate already-started work according to its explicit policy.
- Treat timeout, user cancellation, provider failure, budget exhaustion, and invalid output as distinct structured outcomes.
- Bound complete retained and emitted values, including metadata and wrappers, at the layer that knows their final size.
- Fixture and replay providers are first-class implementations, not test-only bypasses around capability contracts.

## Retrieval security

- Treat all retrieved pages, metadata, and embedded instructions as untrusted data.
- Accept only public HTTP and HTTPS destinations.
- Defend against SSRF at initial resolution and every redirect, including private, loopback, link-local, reserved, multicast, and metadata endpoints.
- Apply explicit bounds for URL length, redirects, DNS/address policy, request time, response bytes, decoded characters, and parsing work.
- Send no ambient credentials or cookies.
- Browser fallback must be isolated and must restrict subresource requests and navigation with the same network policy.
- Record blocked and failed retrievals as structured limitations; do not disguise them as absent evidence.

## Terminal UI rules

- UI components consume engine application services and presentation models, never harness internals or projection tables directly.
- Running the TUI and running the investigation are separate lifecycles. A renderer failure must not corrupt durable work.
- Support keyboard operation, terminal resizing, narrow layouts, screen-reader output, and non-color status indicators.
- Graph rendering performs layout and presentation only. It must not infer provenance relationships.
- Plain and JSON output must contain no ANSI control sequences. JSON mode must contain no decorative or human-only output.
- Restore terminal state on normal exit, cancellation, boot failure, renderer failure, and signals.

## Testing and verification

- Add or update tests with every behavior change.
- Test domain behavior at the lowest owning layer and assembled behavior at the application or CLI layer.
- Use temporary databases and artifact directories for integration tests; never write tests into a user's SourceZero data directory.
- Provider contract tests must run against fixture implementations and every real adapter where practical.
- TUI tests use fixed terminal dimensions and deterministic event fixtures.
- Security-sensitive denials require tests proving the operation is rejected at the enforcing layer.
- Run focused checks during development, then all checks required by the current milestone before marking it complete.
- Record the exact successful verification commands or test suites in the milestone's verification evidence.
- Do not weaken a test, limit, invariant, or acceptance gate merely to make a check pass.

## Files and repository hygiene

- Preserve user changes and unrelated work in a dirty worktree.
- Use repository-relative paths in documentation links.
- Keep generated output, local databases, artifacts, credentials, environment files, and provider caches out of version control.
- Do not perform destructive Git or filesystem operations without explicit authorization.
- Update the PRD only for product decisions, architecture for technical decisions, and milestones for delivery status. Keep each fact in its owning document and link rather than duplicate detail.
- When a change alters public behavior, configuration, durable formats, plugin contracts, or CLI commands, update the owning documentation in the same change.
