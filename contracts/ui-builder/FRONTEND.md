# Frontend install — @markaschmidt/ui-builder-contracts

Private GitHub Packages package. Contains **only** UI document contracts,
JSON Schema, fixtures, and portable editor helpers. It does **not** include
the Nest API / backend source.

## 1. Auth (once per machine / CI)

Create a GitHub PAT with `read:packages` (and `repo` if the package is linked
to a private repository).

In the desktop repo root, add `.npmrc` (do not commit the token):

```ini
@markaschmidt:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Export the token before install:

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

## 2. Install

```bash
pnpm add @markaschmidt/ui-builder-contracts@0.1.1
pnpm add zod@^4 yjs@^13.6.0
```

(or `npm install` / `yarn add` equivalents)

## 3. Import

```ts
import {
  VektreUIDocumentV2Schema,
  type VektreUIDocumentV2,
  migrateHUDDocumentV1,
  composeUiMessageParts,
  // Yjs / apply helpers also export from the package root
} from '@markaschmidt/ui-builder-contracts';

const document = VektreUIDocumentV2Schema.parse(raw);
```

## 4. Examples and schema

After install:

- Fixtures: `node_modules/@markaschmidt/ui-builder-contracts/fixtures/`
- JSON Schema: `node_modules/@markaschmidt/ui-builder-contracts/schemas/vektre-ui-document-v2.schema.json`

Human handoff doc (API behaviour): Nest repo `docs/HUD_FRONTEND_HANDOFF.md`.

## 5. Package URL

https://github.com/markaschmidt/Vektre-Backend/pkgs/npm/ui-builder-contracts

Pin versions (`0.1.1`) and bump when Nest advertises a new document/contract
version via `GET .../ui-agent/capabilities`.

## 6. Review decisions are backend state, not local card state

When a run reaches `awaiting_review`, Approve/Reject/Request-changes must be
submitted to the backend. Marking a card locally does not persist anything:
on the next session the run is still `awaiting_review` and blocks the next
mutating prompt with `409 active_mutating_run`.

```ts
import {
  buildRunReviewRequest,
  uiAgentRunReviewPath,
  withPersistedReviewDecision,
  nextDesktopRunAction,
} from '@markaschmidt/ui-builder-contracts';

// Approve (same for 'reject' / 'request_changes'):
await api.post(
  uiAgentRunReviewPath({ projectId, documentId, runId }),
  buildRunReviewRequest({ decision: 'approve', alternativeId }),
);

// Then re-read the run — its status is the only state to act on:
const run = await api.get(runPath); // status: 'completed' after approve
const turn = withPersistedReviewDecision(run.result, run.review);
```

After approve the run is `completed`, so `nextDesktopRunAction` returns
`inspect_then_apply`: apply `turn` to Yjs once, persist, then
`POST .../runs/:runId/reconcile` with the applied document hash.
The server also stamps the decision into the stored proposal, so a run
re-fetched in a later session applies without being re-blocked.
