"""
Centralized HTTP client with exponential-backoff retry.
=======================================================

WHY THIS EXISTS
---------------
The pipeline's external calls (county listing scrapes, Apify/Zillow comps,
ArcGIS parcel enrichment, PropStream, ATTOM, Gemini) previously each used a raw
`requests.get(...)` with no retry and, in many cases, swallowed failures into an
empty result. A transient 503 or a dropped TLS handshake then looked exactly
like "no data found" — the pipeline silently produced empty/partial output and
nobody noticed until a downstream sheet was wrong.

This module fixes both problems in one place:

  * Exponential backoff retry (via `tenacity`) on transient failures —
    connection errors, timeouts, and retryable HTTP status codes (429, 5xx).
  * FAIL LOUD: after retries are exhausted the underlying exception propagates.
    Callers must NOT convert that into an empty list. Let it raise, log it, and
    surface it — a failed enrichment run should be visibly failed, not silently
    empty.
  * Proper TLS verification by default. A scraper that genuinely needs a narrow
    exception (e.g. a county host with a broken cert chain) should pass
    `verify=False` explicitly AND comment why at the call site — never as a
    blanket default.

USAGE
-----
    from execution.utils.http_client import http_get, http_post, RetryableHTTPError

    resp = http_get(url, headers=HEADERS, timeout=30)   # raises on persistent failure
    resp.raise_for_status()                              # 4xx (non-429) still your call
    data = resp.json()

Tune retries per call with `max_attempts=` / `base_delay=` when a specific
endpoint needs it (e.g. a slow ArcGIS service).
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import requests
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    before_sleep_log,
)

logger = logging.getLogger(__name__)

# HTTP status codes worth retrying: 429 (rate limited) + transient 5xx.
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})

# Defaults — overridable per call.
DEFAULT_MAX_ATTEMPTS = 4
DEFAULT_BASE_DELAY = 1.0   # seconds; doubles each attempt (1, 2, 4, ...)
DEFAULT_MAX_DELAY = 30.0
DEFAULT_TIMEOUT = 30.0     # never block forever

# One shared session → connection pooling + keep-alive across calls.
_SESSION = requests.Session()


class RetryableHTTPError(requests.exceptions.RequestException):
    """Raised for a retryable HTTP status (429/5xx) so tenacity retries it.

    Distinct from a 4xx, which is a caller/logic error and is NOT retried —
    it's returned as a normal response for the caller's own raise_for_status().
    """

    def __init__(self, response: requests.Response):
        self.response = response
        super().__init__(f"retryable HTTP {response.status_code} for {response.url}")


# Exceptions tenacity should retry on: network-level failures + our 5xx/429 wrapper.
_RETRY_EXC = (
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    requests.exceptions.ChunkedEncodingError,
    RetryableHTTPError,
)


def _request(
    method: str,
    url: str,
    *,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    base_delay: float = DEFAULT_BASE_DELAY,
    max_delay: float = DEFAULT_MAX_DELAY,
    timeout: Optional[float] = DEFAULT_TIMEOUT,
    verify: bool = True,
    **kwargs: Any,
) -> requests.Response:
    """Perform an HTTP request with exponential-backoff retry.

    Retries connection errors, timeouts, and 429/5xx responses. Raises the
    underlying exception once attempts are exhausted (FAIL LOUD). A 4xx other
    than 429 is returned as-is — that's a logic error, not a transient one.

    Args:
        verify: TLS certificate verification. Defaults to True. Only pass False
            for a specific host with a known-broken cert chain, and comment why.
    """

    @retry(
        retry=retry_if_exception_type(_RETRY_EXC),
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=base_delay, max=max_delay),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,  # propagate the real exception, not tenacity's RetryError
    )
    def _do() -> requests.Response:
        resp = _SESSION.request(method, url, timeout=timeout, verify=verify, **kwargs)
        if resp.status_code in RETRYABLE_STATUS:
            raise RetryableHTTPError(resp)
        return resp

    try:
        return _do()
    except _RETRY_EXC as e:
        # Loud, attributable failure — callers must not swallow this into empty.
        logger.error(
            "HTTP %s %s failed after %d attempts: %s",
            method, url, max_attempts, e,
        )
        raise


def http_get(url: str, **kwargs: Any) -> requests.Response:
    """GET with retry/backoff. See `_request` for tuning kwargs."""
    return _request("GET", url, **kwargs)


def http_post(url: str, **kwargs: Any) -> requests.Response:
    """POST with retry/backoff. See `_request` for tuning kwargs."""
    return _request("POST", url, **kwargs)
