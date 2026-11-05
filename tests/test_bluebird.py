"""Bluebird days: sun after new snow, from the forecast and SnowSure's own list."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.snowsure.const import DOMAIN
from custom_components.snowsure.parser import bluebird_days, parse_bluebird

from .conftest import SLUG, load_fixture

DAILY = [
    {"date": "2026-11-05", "weather_code": 73, "precipitation_probability": 90, "snowfall": 12, "snowfall_mid": 14},
    {"date": "2026-11-06", "weather_code": 0, "precipitation_probability": 5, "snowfall": 0, "snowfall_mid": 0},
    {"date": "2026-11-07", "weather_code": 1, "precipitation_probability": 10, "snowfall": 0, "snowfall_mid": 0},
    {"date": "2026-11-08", "weather_code": 71, "precipitation_probability": 80, "snowfall": 6, "snowfall_mid": 4},
    {"date": "2026-11-09", "weather_code": 0, "precipitation_probability": 40, "snowfall": 0, "snowfall_mid": 0},
]


def test_clear_dry_day_after_new_snow() -> None:
    # 06: sun after 14 cm. 07: sun, but nothing fell the day before. 09: too likely to precipitate.
    assert bluebird_days(DAILY, "mid") == [{"date": "2026-11-06", "fresh_snow": 14.0, "source": "forecast"}]
    # The summit is missing: the forecast point stands in (12 cm).
    assert bluebird_days(DAILY, "summit")[0]["fresh_snow"] == 12.0


def test_snowsure_predictions_join_in() -> None:
    predictions = parse_bluebird(load_fixture("bluebird_predictions.json")["predictions"], SLUG)
    assert predictions == [
        {"date": "2026-11-09", "confidence": "medium", "snowfall": 6, "temp_max": -8, "wind_max": 12}
    ]
    days = bluebird_days(DAILY, "mid", predictions)
    assert [day["date"] for day in days] == ["2026-11-06", "2026-11-09"]
    assert days[1] == {"date": "2026-11-09", "fresh_snow": 6, "source": "snowsure", "confidence": "medium"}
    assert parse_bluebird(None, SLUG) == []


async def test_bluebird_sensor(hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry) -> None:
    mock_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done()
    entity_id = er.async_get(hass).async_get_entity_id("binary_sensor", DOMAIN, f"{SLUG}_bluebird")
    state = hass.states.get(entity_id)
    assert state.state in ("on", "off")
    assert state.attributes["band"] == "mid"
    assert isinstance(state.attributes["days"], list)
