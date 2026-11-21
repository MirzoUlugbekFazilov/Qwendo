"""Central configuration, loaded once from the repo-root .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Supabase
    supabase_url: str = "https://hfpnbzadymxttjnilkkz.supabase.co"
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    # Embeddings
    embedding_provider: str = "local"
    embedding_dim: int = 1536
    openai_api_key: str = ""
    openai_embedding_model: str = "text-embedding-3-small"

    # Scrapers
    ticketmaster_api_key: str = ""
    eventbrite_token: str = ""
    luma_api_key: str = ""

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    # NoDecode: these arrive as comma-separated strings, not JSON.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )
    ingest_token: str = "change-me-in-production"

    # Ingestion
    default_cities: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["London"])
    ingest_lookahead_days: int = 120
    request_timeout_seconds: int = 30
    max_events_per_source: int = 400

    @field_validator("cors_origins", "default_cities", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def rest_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/rest/v1"

    @property
    def auth_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def has_service_role(self) -> bool:
        return bool(self.supabase_service_role_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
