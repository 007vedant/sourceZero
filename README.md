# SourceZero

> Trace every claim back to zero.

SourceZero is an AI-powered claim-provenance investigator. Its eventual product will let a user confirm one precise claim, investigate its lineage across public webpages, and inspect an evidence-backed provenance graph showing likely origins, independent support, derivative repetition, and changes in wording over time. It is designed for transparent investigation rather than binary fact-checking.

See the [product requirements](docs/product-requirement-doc.md) for the complete product scope and acceptance criteria, and the [architecture](docs/architecture.md) for the local-first engine, investigator harness, persistence, provider, and terminal-client design.

## Current state

M6 is complete: the engine now has a durable, cancellable tool executor, provider-neutral capability seams, deterministic fixture/replay providers, and an OpenAI Responses adapter. The CLI remains fixture-driven until claim framing and the live investigation lifecycle are connected in M7. Track delivery in [milestones.md](docs/milestones.md).

## Build

### Prerequisites

- Node.js 22.5 or later
- pnpm 10.15.0, available through Corepack

### Install and verify

```sh
corepack enable
pnpm install
pnpm verify
```

`pnpm verify` runs the strict TypeScript check, ESLint, Prettier validation, and test suite.

### Build and run the current CLI

```sh
pnpm build
node apps/cli/dist/bin.js
```

In a TTY, the command opens the fixture claim-framing flow and investigation workspace. Redirected output defaults to plain text; use `--json` for machine-readable output. See the [milestone plan](docs/milestones.md) for the remaining investigation capabilities.

## Contributing

Read [AGENTS.md](AGENTS.md) before making changes. It defines the required documentation order, milestone workflow, architecture invariants, TypeScript rules, and verification expectations.
