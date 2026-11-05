"""The development resort behind SNOWSURE_DEMO=1."""

from __future__ import annotations

from datetime import date

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.snowsure.api import SnowsureClient
from custom_components.snowsure.binary_sensor import powder_outlook
from custom_components.snowsure.demo import DEMO_SLUG, demo_avalanche, demo_detail
from custom_components.snowsure.parser import bluebird_days, parse_avalanche, parse_resort

from .conftest import RESORTS_URL, load_fixture


def test_demo_covers_the_cases() -> None:
    today = date(2026, 11, 5)
    data = parse_resort(demo_detail(today))
    assert data["forecast_daily"][0]["date"] == "2026-11-05"
    assert data["forecast_band_elevations"] == {"base": 1450, "mid": 2300, "summit": 3150}
    # Kaiserwetter tomorrow (after 25 cm) and in four days (after 9 cm).
    assert [day["date"] for day in bluebird_days(data["forecast_daily"], "mid")] == ["2026-11-06", "2026-11-09"]
    # Powder alarm today.
    assert powder_outlook(data["forecast_daily"], 15, 2, "mid")[1]["date"] == "2026-11-05"
    assert parse_avalanche(demo_avalanche(today))["avalanche_level"] == 4
    assert (data["depth_summit"], data["is_open"], data["score"]) == (85, True, 72)


async def test_demo_only_with_the_flag(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, monkeypatch: pytest.MonkeyPatch
) -> None:
    aioclient_mock.get(RESORTS_URL, json=load_fixture("resorts.json"))
    client = SnowsureClient(async_get_clientsession(hass), None)

    monkeypatch.delenv("SNOWSURE_DEMO", raising=False)
    assert DEMO_SLUG not in [resort.slug for resort in await client.async_get_resorts()]

    monkeypatch.setenv("SNOWSURE_DEMO", "1")
    assert DEMO_SLUG in [resort.slug for resort in await client.async_get_resorts()]
    calls = aioclient_mock.call_count
    detail = await client.async_get_resort(DEMO_SLUG)
    assert detail["name"] == "Kaiserberg (Demo)"
    assert (await client.async_get_avalanche(DEMO_SLUG))["data"]["dangerRating"] == 4
    assert (await client.async_get_snowpack(DEMO_SLUG))["snowQuality"]["label"] == "dry_powder"
    # Answered locally: no request reached SnowSure.
    assert aioclient_mock.call_count == calls
