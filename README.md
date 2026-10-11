# SourceZero

> Trace every claim back to zero.

SourceZero is an AI-powered claim-provenance investigator. Its eventual product will let a user confirm one precise claim, investigate its lineage across public webpages, and inspect an evidence-backed provenance graph showing likely origins, independent support, derivative repetition, and changes in wording over time. It is designed for transparent investigation rather than binary fact-checking.

See the [product requirements](docs/product-requirement-doc.md) for the complete product scope and acceptance criteria, and the [architecture](docs/architecture.md) for the local-first engine, investigator harness, persistence, provider, and terminal-client design.

## Current state

M8 is complete: a confirmed claim can discover, safely retrieve, extract, and traverse public webpage sources into replayable local artifacts and events. Track delivery in [milestones.md](docs/milestones.md).

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
    },
    "search": { "providerId": "brave.web" },
    "fetch": { "providerId": "sourcezero.http" },
    "extraction": { "providerId": "sourcezero.html" }
  }
}
```

Then provide provider credentials only at execution time:

```sh
OPENAI_API_KEY=... BRAVE_SEARCH_API_KEY=... node apps/cli/dist/bin.js \
  --config sourcezero.config.json \
  --json investigate --confirm "A precise claim to investigate"
```

In a TTY, SourceZero displays the durable proposal for editing and explicit confirmation, then runs bounded source discovery. Redirected output defaults to plain text; add `--json` for machine-readable output or `--confirm` to confirm the first proposal non-interactively. Set `SOURCEZERO_CHROMIUM_PATH` to a local Chromium executable only when browser fallback is wanted. Local investigation data is stored under `~/.sourcezero` by default; use `--data-dir <path>` to override it. See the [milestone plan](docs/milestones.md) for the remaining investigation capabilities.

## Contributing

Read [AGENTS.md](AGENTS.md) before making changes. It defines the required documentation order, milestone workflow, architecture invariants, TypeScript rules, and verification expectations.
