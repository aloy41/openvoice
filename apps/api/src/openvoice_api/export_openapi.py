"""Print the OpenAPI schema as deterministic JSON.

Usage: python -m openvoice_api.export_openapi > openapi.json

Uses fixed dummy settings so the exported contract never depends on the
caller's environment. The committed apps/api/openapi.json is the authoritative
client contract; CI fails on drift.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from pydantic import SecretStr

from .config import Environment, Settings
from .main import create_app


def build_schema() -> dict[str, Any]:
    settings = Settings(
        environment=Environment.TEST,
        secret_key=SecretStr("schema-export-dummy-secret-0123456789abcdef"),
        database_url="postgresql+asyncpg://schema:export@localhost:5432/schema_export",
        redis_url="redis://localhost:6379/0",
        dev_auth_enabled=True,
        dev_auth_password=SecretStr("schema-export-dummy"),
        livekit_api_key="schema-export",
        livekit_api_secret=SecretStr("schema-export-dummy-livekit-secret-0123"),
        livekit_ws_url="ws://localhost:7880",
    )
    return create_app(settings).openapi()


if __name__ == "__main__":
    json.dump(build_schema(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
