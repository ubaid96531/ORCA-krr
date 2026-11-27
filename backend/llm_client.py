"""Unified LLM client for ORCA (local HuggingFace Transformers or OpenAI-compatible API).

Reads optional settings from environment variables or ``.env`` (never commit real keys):
- ``ORCA_LLM_BACKEND``: ``"auto"`` (default), ``"api"``, or ``"local"``.
- ``ORCA_LLM_BASE_URL``: Base URL for OpenAI-compatible ``/chat/completions`` endpoint.
- ``ORCA_LLM_API_KEY``: API key for the OpenAI-compatible endpoint.
- ``ORCA_LLM_MODEL``: Model id for the API endpoint.
- ``ORCA_LOCAL_LLM_MODEL``: HuggingFace model id for local CPU inference
  (default: ``"Qwen/Qwen2.5-0.5B-Instruct"``).
"""
from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import httpx

try:
    from dotenv import load_dotenv

    _ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
    if _ENV_FILE.is_file():
        load_dotenv(_ENV_FILE, override=False)
except ImportError:
    pass

DEFAULT_LOCAL_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
DEFAULT_API_TIMEOUT_S = 30.0


@dataclass(frozen=True)
class LLMResponse:
    """Result from an LLM generation call."""

    text: str
    model: str
    backend: Literal["api", "local", "fake", "none"]
    latency_ms: int
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and bool(self.text.strip())


@dataclass(frozen=True)
class LLMConfig:
    backend: Literal["auto", "api", "local"] = "auto"
    base_url: str | None = None
    api_key: str | None = None
    api_model: str = "gpt-4o-mini"
    local_model: str = DEFAULT_LOCAL_MODEL
    timeout_s: float = DEFAULT_API_TIMEOUT_S

    @classmethod
    def from_env(cls) -> "LLMConfig":
        raw_backend = (os.environ.get("ORCA_LLM_BACKEND") or "auto").strip().lower()
        backend: Literal["auto", "api", "local"] = (
            raw_backend if raw_backend in ("auto", "api", "local") else "auto"  # type: ignore[assignment]
        )
        base_url = (os.environ.get("ORCA_LLM_BASE_URL") or "").strip() or None
        api_key = (os.environ.get("ORCA_LLM_API_KEY") or "").strip() or None
        api_model = (os.environ.get("ORCA_LLM_MODEL") or "gpt-4o-mini").strip()
        local_model = (os.environ.get("ORCA_LOCAL_LLM_MODEL") or DEFAULT_LOCAL_MODEL).strip()
        return cls(
            backend=backend,
            base_url=base_url,
            api_key=api_key,
            api_model=api_model,
            local_model=local_model,
        )

    @property
    def api_configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    @property
    def active_backend(self) -> Literal["api", "local"]:
        if self.backend == "api":
            return "api"
        if self.backend == "local":
            return "local"
        return "api" if self.api_configured else "local"


class LLMClient(Protocol):
    model_name: str
    backend_name: str

    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_new_tokens: int = 240,
        temperature: float = 0.0,
    ) -> LLMResponse: ...


class OpenAICompatibleLLMClient:
    """HTTP client for any OpenAI-compatible ``/v1/chat/completions`` endpoint."""

    backend_name = "api"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model_name: str,
        *,
        timeout_s: float = DEFAULT_API_TIMEOUT_S,
        http_client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model_name = model_name
        self.timeout_s = timeout_s
        self._client = http_client

    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_new_tokens: int = 240,
        temperature: float = 0.0,
    ) -> LLMResponse:
        url = (
            self.base_url
            if self.base_url.endswith("/chat/completions")
            else f"{self.base_url}/chat/completions"
        )
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max_new_tokens,
            "temperature": temperature,
        }
        t0 = time.perf_counter()
        try:
            for attempt in range(2):
                if self._client is not None:
                    resp = self._client.post(url, headers=headers, json=payload, timeout=self.timeout_s)
                else:
                    with httpx.Client(timeout=self.timeout_s) as client:
                        resp = client.post(url, headers=headers, json=payload)
                if resp.status_code in (429, 503) and attempt == 0:
                    time.sleep(1.5)
                    continue
                break
            resp.raise_for_status()
            data = resp.json()
            text = data["choices"][0]["message"]["content"].strip()
            dt = int((time.perf_counter() - t0) * 1000)
            return LLMResponse(text=text, model=self.model_name, backend="api", latency_ms=dt)
        except Exception as exc:
            dt = int((time.perf_counter() - t0) * 1000)
            return LLMResponse(
                text="",
                model=self.model_name,
                backend="api",
                latency_ms=dt,
                error=f"API LLM call failed: {exc}",
            )


_MODEL_LOCK = threading.Lock()
_LOADED_MODELS: dict[str, tuple[object, object]] = {}


def _load_hf_model(model_id: str):
    with _MODEL_LOCK:
        cached = _LOADED_MODELS.get(model_id)
        if cached is not None:
            return cached
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(model_id)
        model = AutoModelForCausalLM.from_pretrained(model_id, dtype=torch.float32)
        model.eval()
        _LOADED_MODELS[model_id] = (tokenizer, model)
        return tokenizer, model


class LocalTransformersLLMClient:
    """Local CPU inference client using HuggingFace ``transformers``."""

    backend_name = "local"

    def __init__(self, model_name: str = DEFAULT_LOCAL_MODEL) -> None:
        self.model_name = model_name

    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_new_tokens: int = 240,
        temperature: float = 0.0,
    ) -> LLMResponse:
        import torch

        t0 = time.perf_counter()
        try:
            tokenizer, model = _load_hf_model(self.model_name)
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
            if hasattr(tokenizer, "apply_chat_template"):
                prompt_text = tokenizer.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True
                )
            else:
                prompt_text = f"System: {system_prompt}\nUser: {user_prompt}\nAssistant:"

            inputs = tokenizer(prompt_text, return_tensors="pt")
            input_len = inputs["input_ids"].shape[1]
            gen_kwargs = {
                "max_new_tokens": max_new_tokens,
                "do_sample": temperature > 0.0,
                "pad_token_id": tokenizer.eos_token_id,
            }
            if temperature > 0.0:
                gen_kwargs["temperature"] = temperature

            with torch.inference_mode():
                output_ids = model.generate(**inputs, **gen_kwargs)

            generated_ids = output_ids[0][input_len:]
            text = tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
            dt = int((time.perf_counter() - t0) * 1000)
            return LLMResponse(text=text, model=self.model_name, backend="local", latency_ms=dt)
        except Exception as exc:
            dt = int((time.perf_counter() - t0) * 1000)
            return LLMResponse(
                text="",
                model=self.model_name,
                backend="local",
                latency_ms=dt,
                error=f"Local LLM generation failed: {exc}",
            )


class FakeLLMClient:
    """Deterministic fake client for automated tests."""

    backend_name = "fake"

    def __init__(
        self,
        response_text: str = "Simulated grounded answer.",
        *,
        model_name: str = "fake-llm",
        error: str | None = None,
        responder=None,
    ) -> None:
        self.response_text = response_text
        self.model_name = model_name
        self.error = error
        self.responder = responder
        self.calls: list[tuple[str, str]] = []

    def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        max_new_tokens: int = 240,
        temperature: float = 0.0,
    ) -> LLMResponse:
        self.calls.append((system_prompt, user_prompt))
        if self.error:
            return LLMResponse(text="", model=self.model_name, backend="fake", latency_ms=1, error=self.error)
        text = self.responder(system_prompt, user_prompt) if self.responder else self.response_text
        return LLMResponse(text=text, model=self.model_name, backend="fake", latency_ms=1)


def get_llm_client(config: LLMConfig | None = None) -> LLMClient:
    """Create the configured LLM client (OpenAI-compatible API if configured, else local HF)."""
    cfg = config or LLMConfig.from_env()
    if cfg.active_backend == "api":
        if not cfg.base_url or not cfg.api_key:
            raise ValueError("ORCA_LLM_BACKEND=api requires ORCA_LLM_BASE_URL and ORCA_LLM_API_KEY.")
        return OpenAICompatibleLLMClient(
            base_url=cfg.base_url,
            api_key=cfg.api_key,
            model_name=cfg.api_model,
            timeout_s=cfg.timeout_s,
        )
    return LocalTransformersLLMClient(model_name=cfg.local_model)
