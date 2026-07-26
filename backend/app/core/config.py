from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    MONGODB_URI: str = Field(
        validation_alias=AliasChoices(
            "MIGRATE_DESTINATION_MONGO_URI", "MONGODB_URL", "MONGODB_URI"
        )
    )
    DATABASE_NAME: str = Field(
        default="StylMe",
        validation_alias=AliasChoices("MONGODB_DB_NAME", "DATABASE_NAME"),
    )

    APP_NAME: str = "StylMe API"
    API_VERSION: str = "v1"
    DEBUG: bool = False
    MONGO_ENSURE_INDEXES_ON_STARTUP: bool = False
    CORS_ORIGINS: str = (
        "http://localhost:3000,"
        "https://fitstylme.vercel.app,"
        "https://stylme-swoopstyl.vercel.app"
    )

    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRES_MINUTES: int = 720

    OWNER_EMAIL: Optional[str] = None
    OWNER_PASSWORD_HASH: Optional[str] = None
    OWNER_FULL_NAME: str = "StylMe Owner"

    STOREFRONT_URL: str = "http://localhost:3000"
    CRON_SECRET: Optional[str] = None
    CHECKOUT_RECOVERY_ENCRYPTION_KEY: Optional[str] = None
    CHECKOUT_RECOVERY_LOCK_SECONDS: int = 240
    CHECKOUT_RECOVERY_HTTP_TIMEOUT_SECONDS: int = 25
    AI_INTERNAL_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("AI_INTERNAL_API_KEY", "INTERNAL_API_KEY"),
    )
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    TAXONOMY_RECONCILER_MODEL: str = "gpt-5.6"
    TAXONOMY_RECONCILER_AUTO_APPLY_CONFIDENCE: float = Field(
        default=0.94, ge=0.5, le=1
    )
    TAXONOMY_RECONCILER_CRON_APPLY: bool = False
    TAXONOMY_RECONCILER_LOCK_SECONDS: int = Field(default=900, ge=60, le=3600)
    TAXONOMY_RECONCILER_QUERY_RETENTION_DAYS: int = Field(
        default=180, ge=30, le=730
    )

    AI_CONTRACT_VERSION: int = 1
    AI_RESERVATION_TTL_SECONDS: int = 300

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, value):
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "production", "prod", "off"}:
                return False
            if normalized in {"debug", "development", "dev", "on"}:
                return True
        return value

    @property
    def cors_origins(self) -> List[str]:
        value = self.CORS_ORIGINS.strip()
        if not value:
            return []
        if value.startswith("["):
            parsed = json.loads(value)
            if not isinstance(parsed, list) or not all(
                isinstance(item, str) for item in parsed
            ):
                raise ValueError("CORS_ORIGINS JSON must be an array of strings")
            return [item.rstrip("/") for item in parsed]
        return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]

    def validate_runtime_security(self) -> None:
        if len(self.JWT_SECRET) < 32:
            raise RuntimeError("JWT_SECRET must contain at least 32 characters")
        if bool(self.OWNER_EMAIL) != bool(self.OWNER_PASSWORD_HASH):
            raise RuntimeError(
                "OWNER_EMAIL and OWNER_PASSWORD_HASH must be configured together"
            )
        if self.OWNER_PASSWORD_HASH and not self.OWNER_PASSWORD_HASH.startswith(
            ("$2a$", "$2b$", "$2y$")
        ):
            raise RuntimeError("OWNER_PASSWORD_HASH must be a bcrypt hash")
        if self.CHECKOUT_RECOVERY_ENCRYPTION_KEY and len(
            self.CHECKOUT_RECOVERY_ENCRYPTION_KEY
        ) < 32:
            raise RuntimeError(
                "CHECKOUT_RECOVERY_ENCRYPTION_KEY must contain at least 32 characters"
            )
        if self.CRON_SECRET and len(self.CRON_SECRET) < 32:
            raise RuntimeError("CRON_SECRET must contain at least 32 characters")
        if self.AI_INTERNAL_API_KEY and len(self.AI_INTERNAL_API_KEY) < 32:
            raise RuntimeError("AI_INTERNAL_API_KEY must contain at least 32 characters")


settings = Settings()
