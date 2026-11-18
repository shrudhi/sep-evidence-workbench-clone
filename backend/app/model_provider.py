import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import get_settings
from .database import connect


class ProviderUnavailable(RuntimeError):
    pass


class ProviderResponseError(RuntimeError):
    pass


@dataclass
class ModelResult:
    data: dict[str, Any]
    model: str
    prompt_hash: str
    latency_ms: int
    usage: dict[str, Any]
    estimated_cost_usd: float
    actual_cost_usd: float | None


def _parse_json_content(content: Any) -> dict[str, Any]:
    """Accept raw JSON or lightly fenced / prefixed model output."""
    if isinstance(content, dict):
        return content
    if not isinstance(content, str):
        raise ValueError(f"Unexpected content type: {type(content)!r}")
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(text[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Structured response must be a JSON object")
    return parsed


class OpenAICompatibleProvider:
    """Small server-side adapter for providers exposing /chat/completions."""

    def __init__(self) -> None:
        self.settings = get_settings()

    def readiness(self) -> dict[str, Any]:
        missing = []
        if not self.settings.model_api_key:
            missing.append("MODEL_API_KEY")
        if not self.settings.mapper_model:
            missing.append("MAPPER_MODEL")
        if not self.settings.reviewer_model:
            missing.append("REVIEWER_MODEL")
        return {
            "ready": not missing,
            "adapter": "openai-compatible",
            "base_url": self.settings.model_api_base,
            "missing": missing,
        }

    def structured(
        self,
        *,
        purpose: str,
        system: str,
        payload: dict[str, Any],
        reviewer: bool = False,
        max_output_tokens: int = 4000,
        run_id: str | None = None,
        images: list[dict[str, str]] | None = None,
    ) -> ModelResult:
        """Call chat/completions. Optional ``images`` are multimodal parts:

        ``[{"evidence_id": "span:…", "data_url": "data:image/png;base64,…", "caption": "…"}]``
        """
        if not self.settings.provider_ready:
            raise ProviderUnavailable(
                "Model provider is not configured. Set MODEL_API_KEY, MAPPER_MODEL, "
                "and REVIEWER_MODEL server-side."
            )
        model = self.settings.reviewer_model if reviewer else self.settings.mapper_model
        prompt = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        image_fingerprint = json.dumps(
            [
                {
                    "evidence_id": item.get("evidence_id"),
                    "caption": item.get("caption"),
                    "sha": hashlib.sha256(
                        (item.get("data_url") or "").encode()
                    ).hexdigest()[:16],
                }
                for item in (images or [])
            ],
            sort_keys=True,
        )
        prompt_hash = hashlib.sha256(
            f"{purpose}\x1f{system}\x1f{prompt}\x1f{image_fingerprint}".encode()
        ).hexdigest()
        # Vision tokens are rough; reserve budget for attached screenshots.
        vision_token_pad = 800 * len(images or [])
        estimated_input_tokens = max(
            1, (len(system) + len(prompt)) // 4 + vision_token_pad
        )
        estimated_cost = (
            estimated_input_tokens * self.settings.input_cost_per_million_usd
            + max_output_tokens * self.settings.output_cost_per_million_usd
        ) / 1_000_000
        if run_id:
            with connect() as connection:
                run = connection.execute(
                    "SELECT estimated_cost_usd FROM runs WHERE id=?", (run_id,)
                ).fetchone()
            if not run:
                raise ProviderResponseError("Unknown run for budget reservation")
            if run["estimated_cost_usd"] + estimated_cost > self.settings.max_run_budget_usd:
                raise ProviderResponseError(
                    f"Model call would exceed the ${self.settings.max_run_budget_usd:.2f} run cap"
                )
        user_content: Any
        if images:
            parts: list[dict[str, Any]] = [
                {
                    "type": "text",
                    "text": (
                        f"{prompt}\n\n"
                        "Attached images are the claim-chart screenshots for the cited "
                        "evidence IDs below. Validate each against the quoted passage."
                    ),
                }
            ]
            for item in images:
                data_url = (item.get("data_url") or "").strip()
                if not data_url.startswith("data:image/"):
                    continue
                caption = item.get("caption") or item.get("evidence_id") or "screenshot"
                parts.append({"type": "text", "text": f"Screenshot for {caption}"})
                parts.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": data_url, "detail": "high"},
                    }
                )
            user_content = parts
        else:
            user_content = prompt
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0,
            "max_tokens": max_output_tokens,
        }
        started = time.perf_counter()
        last_error: Exception | None = None
        result: dict[str, Any] | None = None
        parsed: dict[str, Any] | None = None
        for attempt in range(2):
            try:
                with httpx.Client(timeout=self.settings.model_timeout_seconds) as client:
                    response = client.post(
                        f"{self.settings.model_api_base.rstrip('/')}/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.settings.model_api_key}",
                            "Content-Type": "application/json",
                        },
                        json=body,
                    )
                    response.raise_for_status()
                result = response.json()
                message = result["choices"][0]["message"]
                content = message.get("content")
                if content is None and message.get("refusal"):
                    raise ProviderResponseError(
                        f"Provider refused the request: {message['refusal']}"
                    )
                parsed = _parse_json_content(content)
                break
            except httpx.HTTPError as exc:
                raise ProviderResponseError(f"Provider request failed: {exc}") from exc
            except ProviderResponseError as exc:
                last_error = exc
                if attempt == 0:
                    continue
                raise
            except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                if attempt == 0:
                    continue
                raise ProviderResponseError(
                    "Provider did not return valid structured JSON"
                ) from exc
        if parsed is None or result is None:
            raise ProviderResponseError(
                f"Provider did not return valid structured JSON ({last_error})"
            )
        latency_ms = round((time.perf_counter() - started) * 1000)
        usage = result.get("usage") or {}
        input_tokens = usage.get("prompt_tokens", usage.get("input_tokens"))
        output_tokens = usage.get("completion_tokens", usage.get("output_tokens"))
        actual_cost = None
        if isinstance(input_tokens, int) and isinstance(output_tokens, int):
            actual_cost = (
                input_tokens * self.settings.input_cost_per_million_usd
                + output_tokens * self.settings.output_cost_per_million_usd
            ) / 1_000_000
        return ModelResult(
            data=parsed,
            model=str(result.get("model") or model),
            prompt_hash=prompt_hash,
            latency_ms=latency_ms,
            usage=usage,
            estimated_cost_usd=estimated_cost,
            actual_cost_usd=actual_cost,
        )
