"""Thin async client for the SnowSure public API (https://www.snowsure.ai/developers)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import aiohttp

from .const import API_URL, USER_AGENT

# The resort list is ~1 MB for the whole catalogue and takes a few seconds;
# everything else answers in well under a second.
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30, connect=10)
LIST_TIMEOUT = aiohttp.ClientTimeout(total=90, connect=10)

# Slugs are lower-case words joined by "-" ("matterhorn-ski-paradise"). Anything
# else is rejected before it is put into a URL path.
_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# The catalogue has ~580 resorts and the endpoint returns up to 1000 per page.
# The cursor loop is bounded so a misbehaving cursor cannot spin forever.
_LIST_PAGE_SIZE = 1000
_MAX_LIST_PAGES = 10


class SnowsureError(Exception):
    """A request to SnowSure failed.

    The message is meant for UpdateFailed; the coordinator logs a failed
    refresh once, so this module does not log on its own.
    """


class SnowsureAuthError(SnowsureError):
    """SnowSure rejected the API key."""


class SnowsureNotFoundError(SnowsureError):
    """The resort slug does not exist (any more)."""


class SnowsureRateLimitError(SnowsureError):
    """SnowSure answered 429."""

    def __init__(self, message: str, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


@dataclass(frozen=True, slots=True)
class ResortSummary:
    """One row of the resort catalogue, as the config flow needs it."""

    slug: str
    name: str
    country: str
    region: str


def validate_slug(slug: str) -> str:
    """Return ``slug`` if it is safe to put into a URL path, else raise."""
    if not isinstance(slug, str) or not _SLUG_RE.fullmatch(slug):
        raise ValueError(f"Invalid resort slug: {slug!r}")
    return slug


class SnowsureClient:
    """Fetch resort data from SnowSure.

    The read API is public. An API key is optional: when one is configured it
    is sent as a bearer token, which is how SnowSure identifies entitled (Pro)
    callers - those get the 14-day forecast instead of seven days.
    """

    def __init__(self, session: aiohttp.ClientSession, api_key: str | None = None) -> None:
        self._session = session
        self._api_key = (api_key or "").strip() or None

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    async def _get(
        self,
        path: str,
        params: dict[str, str] | None = None,
        timeout: aiohttp.ClientTimeout = REQUEST_TIMEOUT,
    ) -> Any:
        url = f"{API_URL}{path}"
        try:
            async with self._session.get(url, params=params, headers=self._headers(), timeout=timeout) as response:
                if response.status in (401, 403):
                    raise SnowsureAuthError(f"SnowSure rejected the API key (HTTP {response.status})")
                if response.status == 404:
                    raise SnowsureNotFoundError(f"SnowSure has no data at {path}")
                if response.status == 429:
                    retry_after = _parse_retry_after(response.headers.get("Retry-After"))
                    raise SnowsureRateLimitError("SnowSure rate limit reached (HTTP 429)", retry_after)
                if response.status >= 400:
                    raise SnowsureError(f"SnowSure answered HTTP {response.status} for {path}")
                return await response.json(content_type=None)
        except SnowsureError:
            raise
        except TimeoutError as err:
            raise SnowsureError(f"Timeout while fetching {path} from SnowSure") from err
        except aiohttp.ClientError as err:
            raise SnowsureError(f"Error talking to SnowSure: {err}") from err
        except ValueError as err:
            # json() raises a ValueError subclass for a body that is not JSON.
            raise SnowsureError(f"SnowSure returned invalid JSON for {path}") from err

    async def async_get_resorts(self) -> list[ResortSummary]:
        """Return the whole resort catalogue, sorted by name."""
        resorts: list[ResortSummary] = []
        cursor: str | None = None
        for _ in range(_MAX_LIST_PAGES):
            params = {"limit": str(_LIST_PAGE_SIZE), "sort": "name"}
            if cursor:
                params["cursor"] = cursor
            payload = await self._get("/resorts", params=params, timeout=LIST_TIMEOUT)
            resorts.extend(parse_resort_list(payload))
            cursor = payload.get("nextCursor") if isinstance(payload, dict) else None
            if not cursor:
                break
        return resorts

    async def async_get_resort(self, slug: str) -> dict[str, Any]:
        """Return the ``data`` object of the resort detail endpoint."""
        payload = await self._get(f"/resorts/{validate_slug(slug)}")
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            raise SnowsureError(f"SnowSure returned no resort data for {slug}")
        return data

    async def async_get_avalanche(self, slug: str) -> dict[str, Any]:
        """Return the avalanche envelope (``meta`` + ``data``) for a resort."""
        payload = await self._get(f"/resorts/{validate_slug(slug)}/avalanche")
        if not isinstance(payload, dict):
            raise SnowsureError(f"SnowSure returned no avalanche data for {slug}")
        return payload


def parse_resort_list(payload: Any) -> list[ResortSummary]:
    """Turn a /resorts payload into summaries, skipping malformed rows."""
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []

    resorts: list[ResortSummary] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        slug, name = row.get("slug"), row.get("name")
        if not isinstance(name, str) or not name:
            continue
        try:
            validate_slug(slug)
        except ValueError:
            continue
        resorts.append(
            ResortSummary(
                slug=slug,
                name=name,
                country=row.get("country") if isinstance(row.get("country"), str) else "",
                region=row.get("region") if isinstance(row.get("region"), str) else "",
            )
        )
    return resorts


def _parse_retry_after(value: str | None) -> int | None:
    try:
        return max(int(value), 0) if value is not None else None
    except ValueError:
        return None
