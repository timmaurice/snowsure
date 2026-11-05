"""How many requests a refresh costs: shared bluebird list, locked snowpack kept for a day."""

from __future__ import annotations

from datetime import timedelta

from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker
from yarl import URL

from custom_components.snowsure.const import API_URL, CONF_COUNTRY, CONF_RESORT, CONF_RESORT_NAME, DOMAIN

from .conftest import BLUEBIRD_URL, SLUG, load_fixture

OTHER = "zermatt-copy"


def _mock_resort(aioclient_mock: AiohttpClientMocker, slug: str, snowpack: dict) -> None:
    base = f"{API_URL}/resorts/{slug}"
    detail = load_fixture("resort_detail.json")
    detail["data"]["slug"] = slug
    aioclient_mock.get(base, json=detail)
    aioclient_mock.get(f"{base}/avalanche", json=load_fixture("avalanche_bulletin.json"))
    aioclient_mock.get(f"{base}/forecast-runs", json=load_fixture("forecast_runs.json"))
    aioclient_mock.get(f"{base}/snowpack", json=snowpack)


def _calls(aioclient_mock: AiohttpClientMocker, url: str) -> int:
    path = URL(url).path
    return sum(1 for call in aioclient_mock.mock_calls if call[1].path == path)


def _entry(slug: str) -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title=slug,
        unique_id=slug,
        data={CONF_RESORT: slug, CONF_RESORT_NAME: slug, CONF_COUNTRY: "Switzerland"},
    )


async def _setup(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def test_bluebird_list_is_shared_between_resorts(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, freezer: FrozenDateTimeFactory
) -> None:
    snowpack = load_fixture("snowpack.json")
    for slug in (SLUG, OTHER):
        _mock_resort(aioclient_mock, slug, snowpack)
    aioclient_mock.get(BLUEBIRD_URL, json=load_fixture("bluebird_predictions.json"))

    first, second = _entry(SLUG), _entry(OTHER)
    await _setup(hass, first)
    await _setup(hass, second)
    assert _calls(aioclient_mock, BLUEBIRD_URL) == 1
    # Both resorts read the one list; each keeps only its own rows.
    assert hass.data[DOMAIN]["bluebird"].data
    assert first.runtime_data.data["bluebird_predictions"]
    assert second.runtime_data.data["bluebird_predictions"] == []

    await first.runtime_data.async_refresh()
    assert _calls(aioclient_mock, BLUEBIRD_URL) == 1

    freezer.tick(timedelta(minutes=31))
    await first.runtime_data.async_refresh()
    await second.runtime_data.async_refresh()
    assert _calls(aioclient_mock, BLUEBIRD_URL) == 2


async def test_bluebird_outage_costs_one_request_per_interval(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    for slug in (SLUG, OTHER):
        _mock_resort(aioclient_mock, slug, load_fixture("snowpack.json"))
    aioclient_mock.get(BLUEBIRD_URL, status=503)

    first, second = _entry(SLUG), _entry(OTHER)
    await _setup(hass, first)
    await _setup(hass, second)
    assert _calls(aioclient_mock, BLUEBIRD_URL) == 1
    assert first.runtime_data.last_update_success


async def test_locked_snowpack_is_asked_once_a_day(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, freezer: FrozenDateTimeFactory
) -> None:
    snowpack_url = f"{API_URL}/resorts/{SLUG}/snowpack"
    _mock_resort(aioclient_mock, SLUG, {"data": {"locked": True, "snowQuality": None}})
    aioclient_mock.get(BLUEBIRD_URL, json=load_fixture("bluebird_predictions.json"))

    entry = _entry(SLUG)
    await _setup(hass, entry)
    assert _calls(aioclient_mock, snowpack_url) == 1

    await entry.runtime_data.async_refresh()
    freezer.tick(timedelta(hours=23))
    await entry.runtime_data.async_refresh()
    assert _calls(aioclient_mock, snowpack_url) == 1
    # Still the resort report's label while locked.
    assert entry.runtime_data.data["snow_quality_source"] != "snowpack"

    freezer.tick(timedelta(hours=2))
    await entry.runtime_data.async_refresh()
    assert _calls(aioclient_mock, snowpack_url) == 2


async def test_open_snowpack_is_asked_every_refresh(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    snowpack_url = f"{API_URL}/resorts/{SLUG}/snowpack"
    _mock_resort(aioclient_mock, SLUG, load_fixture("snowpack.json"))
    aioclient_mock.get(BLUEBIRD_URL, json=load_fixture("bluebird_predictions.json"))

    entry = _entry(SLUG)
    await _setup(hass, entry)
    await entry.runtime_data.async_refresh()
    assert _calls(aioclient_mock, snowpack_url) == 2
    assert entry.runtime_data.data["snow_quality_source"] == "snowpack"
