# Vektre UI Builder Contracts

Published as **`@markaschmidt/ui-builder-contracts`** on GitHub Packages
(restricted). See [FRONTEND.md](FRONTEND.md) for desktop install steps.

Portable wire contracts shared by the Nest API, desktop application, and the
private `vektre-ai` service. The npm tarball contains only this folder’s
`dist/`, `schemas/`, `python/`, and `fixtures/` — not Nest API source.

## Source of truth

- Zod v4 schemas in `src/` are authoritative.
- `schemas/` contains generated JSON Schema Draft 2020-12 artifacts.
- `python/` contains generated Pydantic v2 models. Do not edit them manually.
- `fixtures/` contains cross-runtime golden documents and canonical hashes.

The schemas deliberately avoid transforms, dates, maps, functions, and custom
refinements that cannot round-trip through JSON Schema. Record keys are
validated semantically against each value's stable `id`; this keeps generated
Pydantic dictionaries portable.

## Commands

From the repository root:

```bash
pnpm contracts:generate
pnpm contracts:test
pnpm contracts:verify
```

`contracts:verify` builds the TypeScript package, validates fixtures with Zod,
Ajv 2020, and generated Pydantic v2 models, checks semantic invariants, and
verifies RFC 8785 SHA-256 parity between Node and Python.

`GET .../ui-agent/capabilities` advertises `yjsSchemaVersion: 2` and
`documentContract: VektreUIDocumentV2`. Desktop helpers for nested Yjs maps,
RFC 6902 apply, the multimodal composer, and design-memory review live in
`src/yjs-document.ts`, `src/apply-proposal.ts`, `src/conversation.ts`,
`src/memory-ui.ts`, and `src/desktop-workspace.ts`.
