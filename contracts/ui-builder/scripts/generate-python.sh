#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SCHEMA_DIR="${PACKAGE_DIR}/schemas"
OUTPUT_DIR="${PACKAGE_DIR}/python"
GENERATOR_VERSION="0.74.0"

mkdir -p "${OUTPUT_DIR}"

for schema in "${SCHEMA_DIR}"/*.schema.json; do
  filename="$(basename -- "${schema}" .schema.json)"
  module_name="${filename//-/_}"
  uvx --from "datamodel-code-generator==${GENERATOR_VERSION}" \
    datamodel-codegen \
    --input "${schema}" \
    --input-file-type jsonschema \
    --output "${OUTPUT_DIR}/${module_name}.py" \
    --output-model-type pydantic_v2.BaseModel \
    --target-python-version 3.13 \
    --use-standard-collections \
    --use-union-operator \
    --snake-case-field \
    --use-title-as-name \
    --strict-nullable \
    --formatters black isort \
    --disable-timestamp
done

printf '%s\n' "${GENERATOR_VERSION}" > "${OUTPUT_DIR}/GENERATOR_VERSION"
