"""Settings validation: fail-fast behavior, and the security invariant that
development authentication can never be enabled in production (ADR-0003)."""

from __future__ import annotations

import pytest
from pydantic import SecretStr, ValidationError

from openvoice_api.config import Environment
from tests.conftest import make_settings


def test_valid_dev_settings_construct() -> None:
    settings = make_settings()
    assert settings.environment is Environment.TEST
    assert settings.dev_auth_enabled is True


def test_dev_auth_refused_in_production() -> None:
    with pytest.raises(ValidationError, match="production"):
        make_settings(environment=Environment.PRODUCTION, dev_auth_enabled=True)


def test_production_without_dev_auth_is_allowed() -> None:
    settings = make_settings(
        environment=Environment.PRODUCTION, dev_auth_enabled=False, dev_auth_password=None
    )
    assert settings.dev_auth_enabled is False


def test_short_secret_key_rejected() -> None:
    with pytest.raises(ValidationError, match="OPENVOICE_SECRET_KEY"):
        make_settings(secret_key=SecretStr("short"))


def test_dev_auth_requires_password() -> None:
    with pytest.raises(ValidationError, match="OPENVOICE_DEV_AUTH_PASSWORD"):
        make_settings(dev_auth_enabled=True, dev_auth_password=None)


def test_dev_auth_password_min_length() -> None:
    with pytest.raises(ValidationError, match="OPENVOICE_DEV_AUTH_PASSWORD"):
        make_settings(dev_auth_password=SecretStr("tooshort"))


def test_short_livekit_secret_rejected() -> None:
    with pytest.raises(ValidationError, match="LIVEKIT_API_SECRET"):
        make_settings(livekit_api_secret=SecretStr("short"))


def test_voice_token_ttl_bounded() -> None:
    with pytest.raises(ValidationError, match="TTL"):
        make_settings(voice_token_ttl_seconds=3600)
