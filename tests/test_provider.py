import httpx
import pytest

from backend.app.model_provider import OpenAICompatibleProvider, ProviderResponseError


def test_provider_timeout_is_reported_without_secret(monkeypatch):
    provider = OpenAICompatibleProvider()
    monkeypatch.setattr(provider.settings, "model_api_key", "secret-value")
    monkeypatch.setattr(provider.settings, "mapper_model", "mapper")
    monkeypatch.setattr(provider.settings, "reviewer_model", "reviewer")
    monkeypatch.setattr(provider.settings, "model_api_base", "https://provider.invalid/v1")

    class TimeoutClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, *_args, **_kwargs):
            request = httpx.Request("POST", "https://provider.invalid/v1/chat/completions")
            raise httpx.ReadTimeout("timed out", request=request)

    monkeypatch.setattr(httpx, "Client", TimeoutClient)
    with pytest.raises(ProviderResponseError) as raised:
        provider.structured(
            purpose="timeout_test",
            system="Return JSON.",
            payload={"input": "test"},
        )
    assert "secret-value" not in str(raised.value)
