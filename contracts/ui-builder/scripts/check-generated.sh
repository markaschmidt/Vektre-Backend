#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd -- "${PACKAGE_DIR}/../.." && pwd)"

cd "${REPO_DIR}"
pnpm exec ts-node \
  --project contracts/ui-builder/tsconfig.scripts.json \
  contracts/ui-builder/scripts/generate-json-schema.ts
"${PACKAGE_DIR}/scripts/generate-python.sh"
pnpm exec ts-node \
  --files \
  --project contracts/ui-builder/tsconfig.scripts.json \
  contracts/ui-builder/scripts/generate-fixture-hashes.ts

git diff --exit-code -- \
  contracts/ui-builder/schemas \
  contracts/ui-builder/python \
  contracts/ui-builder/fixtures/canonical-hashes.json
