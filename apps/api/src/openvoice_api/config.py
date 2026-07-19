"""Application configuration.

Validated at process start; the API must fail fast with an actionable message
rather than run misconfigured. Security-critical invariant: development
authentication can never be enabled in production (see ADR-0003).
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OPENVOICE_", extra="ignore")

    environment: Environment = Environment.DEVELOPMENT
    secret_key: SecretStr
    database_url: str
    redis_url: str

    dev_auth_enabled: bool = False
    dev_auth_password: SecretStr | None = None
    dev_session_max_age_seconds: int = 12 * 60 * 60

    livekit_api_key: str
    livekit_api_secret: SecretStr
    livekit_ws_url: str
    dev_voice_room: str = "dev-lobby"
    voice_token_ttl_seconds: int = 300

    log_level: str = "INFO"

    @model_validator(mode="after")
    def _check_invariants(self) -> Settings:
        if len(self.secret_key.get_secret_value()) < 32:
            raise ValueError(
                "OPENVOICE_SECRET_KEY must be at least 32 characters. Generate one with: "
                'python -c "import secrets; print(secrets.token_hex(32))"'
            )
        if self.environment is Environment.PRODUCTION and self.dev_auth_enabled:
            raise ValueError(
                "OPENVOICE_DEV_AUTH_ENABLED must not be true when "
                "OPENVOICE_ENVIRONMENT=production. Development authentication is a "
                "development-only mechanism and is refused in production by design (ADR-0003)."
            )
        if self.dev_auth_enabled and (
            self.dev_auth_password is None or len(self.dev_auth_password.get_secret_value()) < 12
        ):
            raise ValueError(
                "OPENVOICE_DEV_AUTH_PASSWORD must be set (minimum 12 characters) when "
                "OPENVOICE_DEV_AUTH_ENABLED=true."
            )
        if len(self.livekit_api_secret.get_secret_value()) < 32:
            raise ValueError(
                "OPENVOICE_LIVEKIT_API_SECRET must be at least 32 characters "
                "(LiveKit requirement). Generate one with: "
                'python -c "import secrets; print(secrets.token_hex(32))"'
            )
        if not 0 < self.voice_token_ttl_seconds <= 600:
            raise ValueError(
                "OPENVOICE_VOICE_TOKEN_TTL_SECONDS must be between 1 and 600; "
                "voice tokens are short-lived by design."
            )
        return self
