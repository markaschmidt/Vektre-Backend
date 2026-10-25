from __future__ import annotations

import hashlib
import importlib
import json
import sys
from pathlib import Path
from typing import Any

import rfc8785

PACKAGE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_DIR / "python"))

from hud_document_v1 import LegacyHUDDocumentV1  # noqa: E402
from vektre_ui_document_v2 import VektreUIDocumentV2  # noqa: E402


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def main() -> None:
    fixtures = PACKAGE_DIR / "fixtures"
    expected_hashes = load_json(fixtures / "canonical-hashes.json")

    for module_path in sorted((PACKAGE_DIR / "python").glob("*.py")):
        if module_path.name != "__init__.py":
            importlib.import_module(module_path.stem)

    for filename in (
        "combat-hud.json",
        "exploration-hud.json",
        "inventory-menu.json",
        "boss-overlay.json",
        "vr-wrist-ui.json",
    ):
        path = fixtures / filename
        raw = path.read_text(encoding="utf-8")
        VektreUIDocumentV2.model_validate_json(raw)
        actual_hash = canonical_hash(json.loads(raw))
        expected_hash = expected_hashes[filename]
        if actual_hash != expected_hash:
            raise AssertionError(
                f"{filename}: Python canonical hash {actual_hash} "
                f"does not match Node hash {expected_hash}"
            )

    LegacyHUDDocumentV1.model_validate_json(
        (fixtures / "legacy-hud-v1.json").read_text(encoding="utf-8")
    )


if __name__ == "__main__":
    main()
