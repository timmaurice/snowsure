"""Tests for the HTTP client."""

from __future__ import annotations

import aiohttp
import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.snowsure.api import (
    SnowsureAuthError,
    SnowsureClient,
    SnowsureError,
    SnowsureNotFoundError,
    SnowsureRateLimitError,
    parse_resort_list,
    validate_slug,
)

from .conftest import AVALANCHE_URL, RESORT_URL, RESORTS_URL, SLUG, load_fixture


def _client(hass: HomeAssistant, api_key: str | None = None) -> SnowsureClient:
    return SnowsureClient(async_get_clientsession(hass), api_key)


async def test_get_resort_returns_data(hass: HomeAssistant, mock_api: AiohttpClientMocker) -> None:
    data = await _client(hass).async_get_resort(SLUG)
    assert data["slug"] == SLUG
    assert data["snowSure"]["score"] == 33
    # The envelope's credits are copied next to the resort data.
    assert data["credits"]["provider"]["text"] == "Data by SnowSure.ai"


async def test_no_authorization_header_without_key(hass: HomeAssistant, mock_api: AiohttpClientMocker) -> None:
    await _client(hass).async_get_resort(SLUG)
    headers = mock_api.mock_calls[-1][3]
    assert "Authorization" not in headers
    assert headers["User-Agent"].startswith("HomeAssistant snowsure")


async def test_key_is_sent_as_bearer(hass: HomeAssistant, mock_api: AiohttpClientMocker) -> None:
    await _client(hass, "  test-key  ").async_get_resort(SLUG)
    assert mock_api.mock_calls[-1][3]["Authorization"] == "Bearer test-key"


async def test_blank_key_counts_as_none(hass: HomeAssistant, mock_api: AiohttpClientMocker) -> None:
    await _client(hass, "   ").async_get_resort(SLUG)
    assert "Authorization" not in mock_api.mock_calls[-1][3]


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (401, SnowsureAuthError),
        (403, SnowsureAuthError),
        (404, SnowsureNotFoundError),
        (500, SnowsureError),
    ],
)
async def test_http_errors_map_to_exceptions(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, status: int, error: type[Exception]
) -> None:
    aioclient_mock.get(RESORT_URL, status=status)
    with pytest.raises(error):
        await _client(hass).async_get_resort(SLUG)


async def test_rate_limit_carries_retry_after(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(RESORT_URL, status=429, headers={"Retry-After": "42"})
    with pytest.raises(SnowsureRateLimitError) as caught:
        await _client(hass).async_get_resort(SLUG)
    assert caught.value.retry_after == 42


@pytest.mark.parametrize("exc", [aiohttp.ClientError("boom"), TimeoutError()])
async def test_transport_errors_become_snowsure_errors(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, exc: Exception
) -> None:
    aioclient_mock.get(RESORT_URL, exc=exc)
    with pytest.raises(SnowsureError):
        await _client(hass).async_get_resort(SLUG)


async def test_invalid_json(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(RESORT_URL, text="<html>maintenance</html>")
    with pytest.raises(SnowsureError):
        await _client(hass).async_get_resort(SLUG)


async def test_missing_data_object(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(RESORT_URL, json={"meta": {}})
    with pytest.raises(SnowsureError):
        await _client(hass).async_get_resort(SLUG)


async def test_avalanche_returns_envelope(hass: HomeAssistant, mock_api: AiohttpClientMocker) -> None:
    payload = await _client(hass).async_get_avalanche(SLUG)
    assert payload["data"]["dangerRating"] == 2
    assert mock_api.mock_calls[-1][1].path == AVALANCHE_URL.split("snowsure.ai")[1]


async def test_resort_list_skips_malformed_rows(hass: HomeAssistant, mock_api: AiohttpClientMocker) -> None:
    resorts = await _client(hass).async_get_resorts()
    slugs = [resort.slug for resort in resorts]
    assert SLUG in slugs
    assert "../etc/passwd" not in slugs
    request_url = mock_api.mock_calls[-1][1]
    assert request_url.query["limit"] == "1000"
    assert request_url.query["sort"] == "name"


async def test_resort_list_follows_cursor(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    page_two = {"data": [{"slug": "oberstdorf", "name": "Oberstdorf", "country": "Germany", "region": "Europe"}]}
    page_one = {
        "data": [{"slug": "wendelstein", "name": "Wendelstein", "country": "Germany", "region": "Europe"}],
        "nextCursor": "abc",
    }
    # Registered first so it wins for the request that carries the cursor.
    aioclient_mock.get(RESORTS_URL, params={"cursor": "abc"}, json=page_two)
    aioclient_mock.get(RESORTS_URL, json=page_one)
    resorts = await _client(hass).async_get_resorts()
    assert [r.slug for r in resorts] == ["wendelstein", "oberstdorf"]


@pytest.mark.parametrize("slug", ["../x", "Zermatt", "a/b", "", "a--b", "-a"])
def test_validate_slug_rejects_unsafe(slug: str) -> None:
    with pytest.raises(ValueError):
        validate_slug(slug)


def test_parse_resort_list_tolerates_garbage() -> None:
    assert parse_resort_list(None) == []
    assert parse_resort_list({"data": "nope"}) == []
    assert parse_resort_list({"data": [1, {"slug": "ok"}, {"slug": "ok", "name": "Ok"}]})[0].name == "Ok"
    assert len(parse_resort_list(load_fixture("resorts.json"))) == 9
