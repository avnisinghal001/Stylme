from __future__ import annotations

import asyncio
import json
import random
from typing import Any, Awaitable, Callable, Dict, Optional

import httpx

from app.core.config import settings


MAX_REQUEST_BYTES = 20 * 1024 * 1024


class SamoraError(RuntimeError):
    def __init__(self, status_code: int | None, code: str, *, retryable: bool):
        super().__init__(f"Samora request failed ({code})")
        self.status_code = status_code
        self.code = code
        self.retryable = retryable


class SamoraClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        client: Optional[httpx.AsyncClient] = None,
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._owned = client is None
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(settings.CHECKOUT_RECOVERY_HTTP_TIMEOUT_SECONDS),
            follow_redirects=False,
        )
        self.sleeper = sleeper

    async def close(self) -> None:
        if self._owned:
            await self.client.aclose()

    async def post(self, path: str, payload: Dict[str, Any], *, retries: int = 3) -> Dict[str, Any]:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if len(body) > MAX_REQUEST_BYTES:
            raise SamoraError(None, "request_too_large", retryable=False)
        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        last_error: SamoraError | None = None
        for attempt in range(retries):
            try:
                response = await self.client.post(
                    f"{self.base_url}{path}", content=body, headers=headers
                )
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = SamoraError(None, "timeout_or_network", retryable=True)
                if attempt + 1 >= retries:
                    raise last_error from exc
                await self.sleeper(min(4.0, 0.25 * (2**attempt)) + random.uniform(0, 0.15))
                continue
            if response.status_code in {200, 201}:
                try:
                    result = response.json()
                except ValueError as exc:
                    raise SamoraError(response.status_code, "invalid_json", retryable=False) from exc
                if not isinstance(result, dict):
                    raise SamoraError(response.status_code, "invalid_response_shape", retryable=False)
                return result
            retryable = response.status_code >= 500
            last_error = SamoraError(
                response.status_code,
                f"http_{response.status_code}",
                retryable=retryable,
            )
            if not retryable or attempt + 1 >= retries:
                raise last_error
            await self.sleeper(min(4.0, 0.25 * (2**attempt)) + random.uniform(0, 0.15))
        raise last_error or SamoraError(None, "unknown", retryable=False)

    async def lookup(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return await self.post("/v1/workflow/activity/lookup", payload)

    async def schedule(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return await self.post("/v1/workflow/campaign/schedule", payload)

    async def bulk_activity(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return await self.post("/v1/workflow/activity/bulk", payload)
