from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_path: Path = Path("data/workbench.db")
    source_dir: Path = Path("sources")
    artifact_dir: Path = Path("data")
    frontend_dir: Path = Path("frontend/dist")

    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    model_api_key: str | None = None
    model_api_base: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    mapper_model: str | None = None
    reviewer_model: str | None = None
    model_timeout_seconds: float = 60.0
    max_run_budget_usd: float = 0.50
    max_active_runs: int = 1
    max_total_runs: int = 25
    input_cost_per_million_usd: float = 0.30
    output_cost_per_million_usd: float = 2.50

    # Email delivery (server-side only; never expose secrets to the frontend)
    email_provider: str = "none"  # none | smtp
    email_from: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True
    app_public_base_url: str = "http://127.0.0.1:8000"

    @property
    def provider_ready(self) -> bool:
        return bool(self.model_api_key and self.mapper_model and self.reviewer_model)


@lru_cache
def get_settings() -> Settings:
    return Settings()
