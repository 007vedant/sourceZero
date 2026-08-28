# SourceZero Product Requirements Document

**Status:** Draft for engineering discussion  
**Version:** 0.1  
**Date:** 27 August 2026  
**Primary product surface:** Web application  
**Secondary product surface:** CLI

## 1. Executive summary

SourceZero is an AI-powered claim-provenance investigator. A user submits a claim or an article URL, and SourceZero investigates where the claim appears to have originated, how many sources independently support it, how its wording changed as it propagated, and whether the evidence behind it remains current.

SourceZero is not a binary fact checker or a generic deep-research chatbot. Its primary artifact is an inspectable provenance graph backed by source passages, classifications, confidence explanations, and a replayable investigation trace. The product helps users distinguish genuine independent support from citation cascades, copied reporting, syndication, and semantic drift.

The initial product will investigate one precisely framed claim at a time across publicly accessible English-language webpages. The web application will be the primary user experience. A CLI backed by the same core engine will support local use, evaluation, debugging, replay, and structured exports.

## 2. Product vision

> Trace every claim back to zero.

SourceZero should make the lineage of an online claim as inspectable as the commit history of a software project. Users should be able to see not only which sources repeat a claim, but also how those sources depend on one another and what evidence each source contributes.

The long-term product may support persistent freshness monitoring, academic literature, social media, images, video, collaborative investigations, and external integrations. The initial release will establish the core claim-provenance model and prove that SourceZero can produce useful, transparent investigations of public web claims.

## 3. Problem statement

Online claims often appear well supported because many webpages repeat them. However, those webpages may all derive from one study, press release, interview, or unsourced statement. Conventional search results and AI-generated summaries flatten these dependencies into a list of citations, creating the impression of consensus without showing whether the sources are independent.

Users currently have to manually answer several difficult questions:

- What is the earliest source that can be located for this claim?
- Which sources contain original evidence?
- Which sources merely cite, quote, copy, paraphrase, or syndicate another source?
- Did the claim become broader or more certain as it propagated?
- Are the original evidence and sources still current?
- What could not be accessed or established during the investigation?

This work is time-consuming, difficult to reproduce, and poorly represented by a flat report with endnotes.

## 4. Goals

### 4.1 Product goals

1. Allow a user to begin an investigation from either a claim or a webpage URL.
2. Ensure the exact claim being investigated is confirmed by the user before substantial work begins.
3. Discover and retrieve relevant public web sources within explicit time and cost limits.
4. Construct an inspectable graph of claims, sources, evidence excerpts, and provenance relationships.
5. Estimate the earliest located source without claiming exhaustive discovery.
6. Distinguish likely independent support from derivative repetition.
7. Show material changes in claim wording and meaning over time.
8. Present findings with source-level evidence, confidence explanations, and limitations.
9. Record a durable event trace sufficient to inspect and replay an investigation.
10. Provide useful web and CLI experiences backed by the same investigation engine.

### 4.2 Portfolio and learning goals

The project should visibly demonstrate:

- A reusable agent loop rather than a fixed prompt chain
- Typed, plugin-based tool execution
- Durable state and event sourcing
- Deterministic graph analysis combined with model judgment
- Context and budget management
- Cancellation, retries, and partial-failure handling
- Human confirmation and correction points
- Evaluation of agent trajectories and final artifacts
- A polished, understandable end-user interface

## 5. Non-goals for the initial release

The initial release will not:

- Produce a universal true/false verdict
- Claim to find the absolute first occurrence of a claim
- Guarantee exhaustive coverage of the web
- Perform formal academic systematic reviews
- Search private, paywalled, or authenticated sources
- Search social-media platforms comprehensively
- Analyze audio or video
- Perform reverse-image provenance analysis
- Support collaborative editing
- Automatically contact source authors or publishers
- Allow the model to modify graph history without logged events
- Depend on multiple cooperating agents unless evaluation proves they improve results

## 6. Target users

### 6.1 Primary users

- Journalists and independent writers checking the origin of a statistic or quotation
- Analysts validating apparent consensus before using a claim in a report
- Students and educators teaching source evaluation and citation lineage
- Creators checking claims before publishing content
- Technically curious users investigating claims encountered online

### 6.2 Initial user needs

Users need to:

- Investigate a claim without learning a complex research methodology
- Understand why sources are considered independent or dependent
- Inspect exact evidence rather than trust an AI summary
- See uncertainty and inaccessible evidence clearly
- Export an investigation for review or reuse

## 7. Product principles

1. **Provenance before prose.** The graph and evidence records are authoritative; reports are rendered from them.
2. **Evidence excerpts, not citation decoration.** Material findings must point to relevant source passages.
3. **Dependency is not falsehood.** A derivative claim may be correct; SourceZero reports dependency separately from truth.
4. **Uncertainty remains visible.** Findings use calibrated language such as “earliest located source” and explain confidence.
5. **Deterministic analysis where possible.** Graph traversal, hashes, dates, counts, and configured similarity calculations are performed by code.
6. **Every consequential mutation is logged.** Model decisions cannot silently rewrite the investigation.
7. **No hidden completeness claim.** Every investigation identifies inaccessible sources and excluded surfaces.
8. **One claim is the unit of work.** The product avoids silently expanding one investigation into an entire article review.

## 8. Core terminology

### Claim

A concise, checkable proposition selected or edited by the user. Different wording may represent the same underlying claim or a mutated claim, depending on semantic differences.

### Source

A retrievable publication or document with a stable identity, such as a webpage, report, study, press release, or news article.

### Evidence excerpt

A source passage used to support a classification or finding. It retains its source location and retrieval metadata.

### Origin candidate

A located source that predates other discovered sources containing the same or an ancestral version of the claim. SourceZero does not assert that an origin candidate is the absolute first source.

### Independent source

A source that contributes original evidence, analysis, reporting, or observation rather than deriving its material support solely from another discovered source.

### Derivative source

A source whose relevant claim appears to depend materially on another source through citation, quotation, paraphrase, copying, syndication, or a shared upstream source.

### Mutation

A material change to a claim's wording or meaning, including changes in certainty, causality, scope, population, measurement, conditions, or caveats.

### Investigation

The complete durable record for one confirmed claim, including inputs, sources, evidence, graph state, events, findings, limitations, and exports.

## 9. Primary user journey

### 9.1 Start an investigation

The user provides one of:

- A claim
- A public webpage URL
- A claim and an optional webpage URL providing context

When a URL is submitted, SourceZero retrieves the page and proposes a small set of checkable claims. The user must select or edit one claim before the full investigation begins.

### 9.2 Confirm scope

SourceZero displays the normalized claim and any material interpretation choices. The user confirms or edits it.

Example:

> Investigate: “Developers using AI assistants complete software tasks 55% faster.”

This confirmation becomes a durable investigation event.

### 9.3 Run the investigation

The web application displays stage-level progress:

1. Frame claim
2. Discover candidate sources
3. Retrieve sources
4. Extract passages and citations
5. Resolve duplicate and dependent sources
6. Estimate origin
7. Compare wording
8. Assemble findings and limitations

The user can cancel the run. A canceled investigation remains inspectable and may show partial results.

### 9.4 Explore results

The completed investigation provides:

- Overview metrics and conclusions
- Interactive source-provenance graph
- Claim-mutation timeline
- Source and evidence table
- Classification explanations
- Limitations and inaccessible-source list
- Expandable execution trace
- Export actions

## 10. Functional requirements

Priorities use **P0** for required MVP functionality, **P1** for the first follow-up release, and **P2** for later development.

### 10.1 Investigation creation and claim framing

#### SZ-FR-001 — Claim input (**P0**)

The user can create an investigation from a manually entered claim.

**Acceptance criteria:**

- Empty claims are rejected.
- The original input is preserved.
- The user can edit the normalized claim before confirmation.
- No full investigation starts before confirmation.

#### SZ-FR-002 — URL input (**P0**)

The user can create an investigation from a publicly accessible HTTP or HTTPS URL.

**Acceptance criteria:**

- The system retrieves the page or reports a structured retrieval failure.
- The system proposes up to five checkable claims from successfully retrieved content.
- The user can select, edit, or manually replace a proposed claim.
- Page-derived context is linked to the investigation.

#### SZ-FR-003 — Claim confirmation (**P0**)

The system requires explicit confirmation of the precise claim being investigated.

**Acceptance criteria:**

- The confirmed claim is stored as a durable event.
- Later changes create new events rather than overwriting the confirmed record.
- Reframing after substantive investigation work requires an explicit restart or branch decision.

### 10.2 Source discovery and retrieval

#### SZ-FR-010 — Web search (**P0**)

The harness can issue search queries and store query metadata and returned candidates.

**Acceptance criteria:**

- Every query is recorded in the event trace.
- Duplicate candidate URLs are normalized where possible.
- Search failures are retried only under the configured policy.
- Search count is subject to a per-investigation budget.

#### SZ-FR-011 — Page retrieval (**P0**)

The harness can retrieve and extract readable content and metadata from public webpages.

**Acceptance criteria:**

- Retrieval status, resolved URL, timestamp, title, publication-date candidates, and content hash are stored.
- Redirects remain inspectable.
- Failed and blocked pages appear in limitations.
- Retrieved content is associated with its retrieval event.

#### SZ-FR-012 — Citation traversal (**P0**)

The harness can discover citations, hyperlinks, named upstream sources, and exact-phrase leads from retrieved material.

**Acceptance criteria:**

- Every followed lead records its parent source and discovery reason.
- Traversal respects configured depth and source-count limits.
- Unfollowed leads remain visible when a budget stops traversal.

#### SZ-FR-013 — Web archive lookup (**P1**)

The harness can query supported web archives for older versions or unavailable pages.

### 10.3 Source understanding

#### SZ-FR-020 — Relevant passage extraction (**P0**)

The system extracts passages relevant to the confirmed claim.

**Acceptance criteria:**

- Every evidence excerpt includes source identity and a recoverable location when the source format permits it.
- The original text remains available for inspection.
- Generated summaries are not stored as if they were source excerpts.

#### SZ-FR-021 — Source classification (**P0**)

The system classifies relevant sources as primary, secondary, derivative, or unresolved for this claim.

**Acceptance criteria:**

- Classification includes a confidence level and explanation.
- Classification cites the evidence used.
- “Unresolved” is supported and displayed as a first-class result.

#### SZ-FR-022 — Duplicate and near-duplicate detection (**P0**)

The system identifies exact duplicates, syndication, and probable near-duplicate content.

**Acceptance criteria:**

- Exact duplicate detection uses deterministic content identities where possible.
- Probable duplication exposes the similarity evidence and threshold used.
- Users can expand collapsed duplicate groups.

#### SZ-FR-023 — Relationship classification (**P0**)

The system creates evidence-backed relationships between sources and claims.

Initial relationship types:

- `cites`
- `quotes`
- `paraphrases`
- `copies`
- `syndicates`
- `independently_supports`
- `contradicts`
- `supersedes`
- `unresolved_dependency`

**Acceptance criteria:**

- Relationships identify the creating event.
- Model-created relationships include evidence and an explanation.
- Invalid node or edge references are rejected deterministically.
- Relationship changes are additive events, not silent overwrites.

### 10.4 Origin and independence analysis

#### SZ-FR-030 — Origin estimation (**P0**)

The system identifies one or more earliest located origin candidates.

**Acceptance criteria:**

- Findings use “earliest located” terminology.
- Publication-date uncertainty is visible.
- Competing origin candidates may coexist.
- The finding explains why a candidate predates or precedes others.

#### SZ-FR-031 — Independence analysis (**P0**)

The system estimates how many relevant sources offer likely independent support.

**Acceptance criteria:**

- Apparent source count and likely independent-source count are shown separately.
- The interface explains why each source was treated as independent, dependent, or unresolved.
- Shared upstream sources are represented in the graph.
- The product does not equate independence with correctness.

### 10.5 Mutation analysis

#### SZ-FR-040 — Claim variant extraction (**P0**)

The system records materially relevant formulations of the claim from discovered sources.

#### SZ-FR-041 — Mutation classification (**P0**)

The system identifies material changes between chronologically related claim variants.

Initial mutation dimensions:

- Certainty increased or decreased
- Correlation changed to causation
- Population broadened or narrowed
- Metric changed
- Conditions removed or added
- Caveat removed or added
- Numerical value introduced or changed
- Scope broadened or narrowed

**Acceptance criteria:**

- The original source wording is displayed alongside the later wording.
- Each mutation label includes an explanation.
- Uncertain lineage is marked rather than presented as established copying.

### 10.6 Freshness

#### SZ-FR-050 — Freshness summary (**P0, limited**)

The initial release records retrieval dates, source availability, publication dates, and obvious correction or supersession signals found during the investigation.

#### SZ-FR-051 — Manual refresh (**P1**)

The user can rerun discovery and retrieval for an existing investigation and view an evidence diff.

#### SZ-FR-052 — Scheduled monitoring (**P2**)

The user can schedule freshness checks and receive notifications about material changes.

### 10.7 Results and visualization

#### SZ-FR-060 — Overview (**P0**)

The investigation overview displays:

- Confirmed claim
- Earliest located source or competing candidates
- Apparent source count
- Likely independent-source count
- Derivative-source count
- Contradicting-source count
- Origin confidence
- Freshness status
- Concise findings summary

#### SZ-FR-061 — Interactive graph (**P0**)

The user can inspect the provenance graph.

**Acceptance criteria:**

- Claims, sources, and evidence are visually distinguishable.
- Users can filter by source and relationship type.
- Clicking a node or edge opens its evidence and explanation.
- Duplicate groups can be expanded or collapsed.
- Users can highlight descendants or upstream dependencies.
- The graph remains usable for the configured maximum MVP investigation size.

#### SZ-FR-062 — Mutation timeline (**P0**)

The user can inspect chronological claim variants and material mutations.

#### SZ-FR-063 — Evidence table (**P0**)

The user can inspect sources in a sortable table containing source type, date, relationship, independence classification, confidence, and relevant excerpts.

#### SZ-FR-064 — Limitations panel (**P0**)

Every investigation identifies:

- Inaccessible or failed sources
- Excluded source surfaces
- Budget-limited unexplored leads
- Unverified dates or metadata
- Material unresolved classifications
- The non-exhaustive meaning of “earliest located source”

#### SZ-FR-065 — Investigation-grounded follow-up questions (**P1**)

Users can ask questions answered only from the saved investigation graph and evidence.

### 10.8 Investigation trace and controls

#### SZ-FR-070 — Stage-level progress (**P0**)

The UI displays understandable investigation stages without exposing private model reasoning.

#### SZ-FR-071 — Technical trace (**P0**)

The user can inspect tool calls, tool outcomes, graph mutations, failures, retries, and budget usage.

#### SZ-FR-072 — Cancellation (**P0**)

The user can cancel a running investigation.

**Acceptance criteria:**

- No new tool work begins after cancellation is acknowledged.
- Started work is settled or safely abandoned according to tool policy.
- Partial results and cancellation reason remain inspectable.

#### SZ-FR-073 — Replay (**P0, developer-facing**)

The system can reconstruct the investigation state from its durable events. Model and external tool calls do not need to be repeated to replay recorded state.

### 10.9 Export and sharing

#### SZ-FR-080 — Markdown export (**P0**)

The user can export a readable report with findings, evidence references, and limitations.

#### SZ-FR-081 — JSON export (**P0**)

The user can export the investigation graph, classifications, evidence metadata, findings, limitations, and format version.

#### SZ-FR-082 — Event-trace export (**P0, developer-facing**)

The CLI can export the durable investigation trace.

#### SZ-FR-083 — Public read-only sharing (**P1**)

Users can create a stable, read-only link to a completed investigation.

### 10.10 User corrections

#### SZ-FR-090 — Graph correction (**P1**)

Users can propose corrections to source identity, claim equivalence, relationship classification, dates, or exclusions.

**Acceptance criteria:**

- Corrections are stored as attributed events.
- The original machine classification remains auditable.
- Dependent findings are recomputed after an accepted correction.

## 11. CLI requirements

The CLI and website must use the same core investigation engine and durable data model.

Initial command family:

```text
sourcezero investigate <claim>
sourcezero investigate --url <url>
sourcezero list
sourcezero show <investigation-id>
sourcezero export <investigation-id> --format markdown|json|events
sourcezero replay <investigation-id>
sourcezero cancel <investigation-id>
```

P1 command:

```text
sourcezero refresh <investigation-id>
```

CLI output must support human-readable output and machine-readable JSON for appropriate commands. Exit codes must distinguish success, user cancellation, budget exhaustion, configuration failure, and terminal investigation failure.

## 12. Conceptual information model

The following is a product-level model, not a prescribed database schema.

### Investigation

- Identifier
- Original input
- Confirmed claim
- Status
- Created and updated timestamps
- Configuration and budgets
- Current graph projection
- Findings
- Limitations
- Format version

### Claim node

- Identifier
- Canonical wording
- Exact observed wording where applicable
- Source association
- Confidence
- Temporal metadata

### Source node

- Identifier
- Canonical and resolved URLs
- Title
- Publisher or organization
- Author metadata when available
- Publication-date candidates and confidence
- Retrieval timestamp and status
- Content identity
- Source classification

### Evidence record

- Identifier
- Source identifier
- Exact excerpt
- Recoverable location
- Retrieval event
- Supported classifications or findings

### Relationship edge

- Identifier
- Source and destination nodes
- Relationship type
- Confidence
- Explanation
- Supporting evidence
- Creating and superseding events

### Investigation event

- Sequence identifier
- Type
- Timestamp
- Causal parent or source events where applicable
- Structured payload
- Producer identity

## 13. Agent-harness requirements

### 13.1 Agent loop

The harness must support iterative model-tool interaction. At each step, the investigator evaluates current graph state, open uncertainties, available leads, remaining budget, and stopping conditions.

The initial implementation should prefer one investigator agent with specialized tools. Additional agents such as a skeptic or classifier should be introduced only if evaluation demonstrates improved outcomes that justify added cost and complexity.

### 13.2 Tool system

Tools must have typed inputs, typed or normalized outputs, explicit failure behavior, timeouts, and cancellation support.

Expected initial capabilities include:

- Web search
- Page retrieval and readable-text extraction
- Metadata extraction
- Citation and link extraction
- Exact-phrase search
- Passage comparison
- Graph read operations
- Validated graph mutation operations
- Evidence recording

Tools may be implemented directly or exposed through a compatible plugin protocol. The harness should not require tools to be hardcoded into the agent loop.

### 13.3 Event sourcing

All model-visible inputs and consequential graph changes must be reconstructable from the durable investigation event log.

The system must distinguish:

- Raw retrieved evidence
- Model-proposed classifications
- Deterministic analysis results
- User corrections
- Rendered findings

### 13.4 Budgets

Every investigation must have configurable limits for:

- Search requests
- Retrieved sources
- Citation-traversal depth
- Model tokens or equivalent cost
- Wall-clock duration
- Per-tool timeout
- Retry count
- Graph size

Budget exhaustion should produce a valid partial investigation with explicit limitations rather than a misleading complete result.

### 13.5 Stopping conditions

The harness must not rely solely on an unconstrained model decision to stop. The stopping policy should consider:

- Remaining promising leads
- Whether recent discovery rounds found earlier sources
- Whether major classifications have supporting evidence
- Whether required result sections can be rendered
- Remaining time and cost budgets
- User cancellation

Exact policy and thresholds are engineering and evaluation decisions.

## 14. Non-functional requirements

### 14.1 Transparency

- Material findings link to supporting evidence.
- Model classifications identify their confidence and rationale.
- Retrieval failures and unresolved states remain visible.
- The product does not expose private chain-of-thought reasoning.

### 14.2 Reliability

- Individual source failures do not normally terminate the entire investigation.
- Transient failures follow bounded retry policies.
- Investigation state survives process restart after durable events are committed.
- Duplicate tool calls should be avoided or made idempotent where practical.

### 14.3 Performance

Initial targets, subject to measurement:

- User receives claim-framing feedback within 10 seconds for ordinary inputs.
- Stage-level progress begins within 3 seconds after confirmation.
- Default investigation completes within 5 minutes under normal provider conditions.
- The UI remains responsive while an investigation runs.

These are product targets rather than hard external-service guarantees.

### 14.4 Security and privacy

- MVP retrieval is limited to public HTTP and HTTPS sources.
- URL fetching must defend against server-side request forgery and access to private network addresses.
- Retrieved content is untrusted and must not override system or tool policy.
- Secrets must not enter prompts, logs, exports, or client bundles.
- Graph mutation is permitted only through validated operations.
- Exports must not include hidden credentials or provider payloads containing secrets.
- Hosted deployments require per-user and global rate limits.

### 14.5 Accessibility

- Core findings must be usable without relying solely on graph visualization.
- The evidence table and report provide equivalent access to material information.
- Color is not the only indicator of node, edge, confidence, or status.
- Keyboard navigation and screen-reader labels are required for primary workflows.

### 14.6 Portability

- The investigation engine is independent of the web UI.
- The model interface is provider-neutral internally, although MVP may ship with one provider.
- Durable formats are versioned.
- CLI and web projections must interpret the same stored investigation consistently.

## 15. Evaluation strategy

Evaluation is a required product feature, not a post-launch activity.

### 15.1 Evaluation dataset

The MVP evaluation set should contain at least 25 claims, including:

- Synthetic citation networks with known origin and dependencies
- Public claims with well-documented provenance
- Claims with multiple genuinely independent sources
- Claims dominated by syndication or copied reporting
- Claims whose wording materially mutated
- Claims with ambiguous or competing origin candidates
- Claims involving inaccessible sources
- Claims for which the correct result is unresolved

Synthetic cases provide deterministic ground truth. Public cases measure realistic retrieval and interpretation behavior.

### 15.2 Core metrics

- Claim-framing accuracy
- Source relevance precision
- Origin-candidate recall within the retrieved corpus
- Source-dependency classification accuracy
- Independent-source count error
- Duplicate and syndication detection accuracy
- Mutation-label precision and recall
- Evidence-to-finding support rate
- Unsupported material finding rate
- Citation resolution rate
- Tool-call count, tokens, latency, and estimated cost
- Successful cancellation and replay rate

### 15.3 Regression policy

Changes to prompts, models, tools, stopping policies, similarity thresholds, or graph rules must be evaluated against the same representative suite. Resource reductions count as improvements only when quality thresholds continue to pass.

## 16. Success criteria

### 16.1 MVP product success

The MVP is ready for a public portfolio demo when:

1. A new user can investigate a claim without developer assistance.
2. The system produces a graph whose material relationships can be inspected back to evidence.
3. Apparent and likely independent source counts are shown separately and explained.
4. At least one meaningful mutation timeline can be demonstrated end to end.
5. Partial failures and limitations are visible rather than hidden.
6. An investigation can be canceled, replayed, and exported.
7. The CLI and website produce consistent projections from the same investigation.
8. The evaluation suite reports quality, latency, tool usage, and cost.
9. At least two synthetic lineage cases and three public demonstration cases pass documented acceptance expectations.

### 16.2 Suggested portfolio demo

The primary demo should investigate a claim with an interesting citation cascade and show:

1. Claim confirmation
2. Live tool and stage progress
3. Discovery of an apparent consensus
4. Collapse to a smaller number of independent sources
5. A wording mutation
6. Evidence-backed graph inspection
7. Limitations
8. JSON or Markdown export

## 17. Analytics and operational visibility

For hosted operation, collect privacy-conscious product and system metrics:

- Investigation starts, confirmations, completions, cancellations, and failures
- Time to first progress and time to completion
- Sources discovered, retrieved, failed, and classified
- Search, fetch, and model usage per investigation
- Budget-exhaustion frequency
- Graph and evidence-table interactions
- Export usage
- User correction frequency after P1

Do not collect source content or user claims in external telemetry by default without explicit disclosure and a defined retention policy.

## 18. Release plan

### Phase 0 — Technical proof

- Core event model
- One provider adapter
- Search and page-fetch tools
- Minimal investigator loop
- Graph projection
- Synthetic source-lineage fixture
- CLI-only output

### Phase 1 — MVP

- Full P0 requirements
- Web investigation workflow
- Interactive graph, timeline, evidence table, and trace
- Saved local or hosted investigations
- Markdown, JSON, and event exports
- Evaluation harness and documented demo cases

### Phase 1.1 — Freshness and sharing

- Manual refresh and evidence diff
- Web archive integration
- Public read-only links
- User corrections
- Investigation-grounded questions

### Phase 2 — Expansion

- Scheduled freshness monitoring
- Academic PDFs and retraction signals
- Browser extension
- Images and chart provenance
- Social-media lineage where APIs and policies permit
- Collaboration, API, and MCP exposure
- Multilingual investigations

## 19. Product decisions already made

| Question                 | Decision                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| Product name             | SourceZero                                                               |
| Tagline                  | “Trace every claim back to zero.”                                        |
| Primary surface          | Website                                                                  |
| Secondary surface        | CLI                                                                      |
| Product metaphor         | Investigation workspace                                                  |
| Initial audience         | Journalists, analysts, students, creators, and curious users             |
| Initial source scope     | Public English-language webpages                                         |
| Unit of work             | One user-confirmed claim                                                 |
| Primary artifact         | Provenance graph backed by evidence                                      |
| Binary truth verdict     | Excluded from MVP                                                        |
| Origin language          | “Earliest located source”                                                |
| Freshness                | Basic signals in MVP; manual refresh in P1                               |
| Model support            | One provider may ship first; internal interface remains provider-neutral |
| Social media             | Deferred                                                                 |
| Academic PDFs            | Deferred                                                                 |
| Browser extension        | Deferred                                                                 |
| Multi-agent architecture | Not required unless evaluation proves value                              |

## 20. Questions for engineering discussion

These questions should be resolved during technical design rather than assumed by the PRD:

1. Which search and webpage extraction providers satisfy cost, licensing, and reliability needs?
2. What storage model best supports an immutable event log and efficient graph projection?
3. Should the CLI run investigations entirely locally, use a hosted API, or support both modes?
4. Which model provider and model should establish the first evaluation baseline?
5. How should URL canonicalization, publication identity, and syndicated-source identity be resolved?
6. Which deterministic and model-assisted techniques should be combined for near-duplicate detection?
7. How should confidence be represented without creating false precision?
8. What maximum graph size keeps the MVP visualization usable?
9. Which external content may legally be stored, for how long, and in what form?
10. What sandboxing and network controls will protect the fetcher from malicious or private endpoints?
11. Which events and payloads form the first durable format version?
12. What deployment and authentication model best balances a public résumé demo with provider cost control?

## 21. Risks and mitigations

| Risk                                           | Impact                     | Initial mitigation                                                      |
| ---------------------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| Source discovery is incomplete                 | False confidence in origin | Use “earliest located,” expose budgets and unexplored leads             |
| Models invent relationships                    | Incorrect graph            | Require evidence, validate mutations, evaluate classification accuracy  |
| Publication dates are unreliable               | Incorrect chronology       | Store date candidates and confidence; permit competing origins          |
| Search and model costs grow rapidly            | Unsustainable hosted demo  | Hard budgets, caching, deduplication, per-user limits                   |
| Websites block retrieval                       | Missing evidence           | Structured failures, limitations, later archive integration             |
| Similar wording is treated as proof of copying | Misleading dependency      | Express uncertainty and combine multiple dependency signals             |
| Retrieved pages contain prompt injection       | Unsafe agent behavior      | Treat content as data; restrict tools and graph mutations               |
| Graph overwhelms users                         | Poor usability             | Progressive disclosure, filters, duplicate collapsing, evidence table   |
| Project expands into generic deep research     | Loss of differentiation    | Keep one-claim provenance as the central product constraint             |
| Freshness scope delays MVP                     | Schedule risk              | Limit MVP freshness to recorded dates and discovered correction signals |

## 22. Final MVP statement

The SourceZero MVP is complete when a user can submit and confirm one claim, watch a bounded agent investigate public webpages, and receive an inspectable provenance graph that identifies earliest located source candidates, separates likely independent support from derivative repetition, shows material wording mutations, links findings to exact evidence, discloses limitations, and can be replayed and exported through both a website and CLI.
