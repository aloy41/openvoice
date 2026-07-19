"""Test fixtures.

Integration tests run against real PostgreSQL (never SQLite) and Redis from
the compose stack; they skip with a clear reason when
OPENVOICE_TEST_DATABASE_URL is not set. Migrations are applied once per
session via the real alembic CLI so the migration path itself is exercised.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from openvoice_api.config import Environment, Settings
from openvoice_api.main import create_app

TEST_DB_URL = os.environ.get("OPENVOICE_TEST_DATABASE_URL")
REDIS_URL = os.environ.get("OPENVOICE_REDIS_URL", "redis://redis:6379/0")

API_DIR = Path(__file__).resolve().parents[1]

TEST_DEV_PASSWORD = "test-dev-password"  # fake credential for tests only
TEST_LIVEKIT_SECRET = "test-livekit-secret-0123456789abcdef"  # fake, tests only

requires_db = pytest.mark.skipif(
    TEST_DB_URL is None,
    reason="OPENVOICE_TEST_DATABASE_URL not set — run via the compose stack "
    "(docker compose -f docker-compose.dev.yml run --rm api pytest)",
)


def make_settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "environment": Environment.TEST,
        "secret_key": SecretStr("unit-test-secret-key-0123456789abcdef"),
        "database_url": TEST_DB_URL or "postgresql+asyncpg://invalid:invalid@localhost:1/invalid",
        "redis_url": REDIS_URL,
        "dev_auth_enabled": True,
        "dev_auth_password": SecretStr(TEST_DEV_PASSWORD),
        "livekit_api_key": "testkey",
        "livekit_api_secret": SecretStr(TEST_LIVEKIT_SECRET),
        "livekit_ws_url": "ws://localhost:7880",
    }
    base.update(overrides)
    return Settings(**base)


@pytest.fixture(scope="session", autouse=True)
def migrated_db() -> None:
    if TEST_DB_URL is None:
        return
    env = {**os.environ, "OPENVOICE_DATABASE_URL": TEST_DB_URL}
    subprocess.run(["alembic", "upgrade", "head"], check=True, env=env, cwd=API_DIR)


@pytest.fixture()
async def clean_db() -> AsyncIterator[None]:
    assert TEST_DB_URL is not None
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE users CASCADE"))
    await engine.dispose()
    yield


@pytest.fixture()
def app() -> FastAPI:
    return create_app(make_settings())


@pytest.fixture()
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def login(client: AsyncClient, username: str = "alice") -> str:
    resp = await client.post(
        "/api/v1/dev/session", json={"username": username, "password": TEST_DEV_PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["token"])


TEST_USER_PASSWORD = "test-password-123"  # fake credential for tests only


def uname(prefix: str) -> str:
    """Unique username per call: avoids cross-run auth rate-limit windows and
    cross-test collisions."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


@asynccontextmanager
async def user_client(app: FastAPI, username: str) -> AsyncIterator[AsyncClient]:
    """A registered, cookie-authenticated client with the CSRF header
    pre-attached to every request."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        await c.get("/api/healthz")
        csrf = c.cookies.get("ov_csrf")
        assert csrf
        c.headers.update({"x-csrf-token": csrf})
        resp = await c.post(
            "/api/v1/auth/register",
            json={"username": username, "password": TEST_USER_PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        yield c
