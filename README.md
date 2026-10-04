# SourceZero

> Trace every claim back to zero.

SourceZero is an AI-powered claim-provenance investigator. Its eventual product will let a user confirm one precise claim, investigate its lineage across public webpages, and inspect an evidence-backed provenance graph showing likely origins, independent support, derivative repetition, and changes in wording over time. It is designed for transparent investigation rather than binary fact-checking.

See the [product requirements](docs/product-requirement-doc.md) for the complete product scope and acceptance criteria, and the [architecture](docs/architecture.md) for the local-first engine, investigator harness, persistence, provider, and terminal-client design.

## Current state

M7 is complete: claim input can be normalized through the configured model, reviewed, edited, explicitly confirmed, and started as a durable bounded run. URL framing is wired through fetch and extraction provider seams and deterministic fixtures; the hardened real web retriever arrives in M8. Track delivery in [milestones.md](docs/milestones.md).

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

### Build and run the CLI

```sh
pnpm build
node apps/cli/dist/bin.js
```

The no-argument command still opens the deterministic demo workspace. To run live claim framing, create a local configuration such as:

```json
{
  "providers": {
    "model": {
      "providerId": "openai.responses",
      "modelId": "YOUR_MODEL_ID"
    }
  }
}
```

Then provide `OPENAI_API_KEY` only at execution time:

```sh
OPENAI_API_KEY=... node apps/cli/dist/bin.js \
  --config sourcezero.config.json \
  investigate "A precise claim to investigate"
```

In a TTY, SourceZero displays the durable proposal for editing and explicit confirmation. Redirected output defaults to plain text; add `--json` for machine-readable output or `--confirm` to explicitly confirm the first proposal non-interactively. Local investigation data is stored under `~/.sourcezero` by default; use `--data-dir <path>` to override it. See the [milestone plan](docs/milestones.md) for the remaining investigation capabilities.

## Contributing

Read [AGENTS.md](AGENTS.md) before making changes. It defines the required documentation order, milestone workflow, architecture invariants, TypeScript rules, and verification expectations.
