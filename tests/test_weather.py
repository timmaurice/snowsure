"""The resort's weather entity."""

from __future__ import annotations

from homeassistant.components.weather import DOMAIN as WEATHER_DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.snowsure.const import DOMAIN
from custom_components.snowsure.weather import condition

from .conftest import SLUG


async def test_weather_entity(hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry) -> None:
    mock_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done()

    entity_id = er.async_get(hass).async_get_entity_id(WEATHER_DOMAIN, DOMAIN, f"{SLUG}_weather")
    # Named after the resort: weather.matterhorn_ski_paradise.
    assert entity_id == "weather.matterhorn_ski_paradise"
    state = hass.states.get(entity_id)
    assert state.state == "snowy"
    assert state.attributes["temperature"] == -13.1
    assert state.attributes["humidity"] == 94
    assert state.attributes["wind_speed"] == 6.9
    assert state.attributes["attribution"] == "Data by SnowSure.ai"

    response = await hass.services.async_call(
        WEATHER_DOMAIN,
        "get_forecasts",
        {"entity_id": entity_id, "type": "daily"},
        blocking=True,
        return_response=True,
    )
    days = response[entity_id]["forecast"]
    assert len(days) == 14
    assert days[0] == {
        "datetime": "2026-11-04",
        "condition": "snowy",
        "temperature": -12.8,
        "templow": -14.5,
        "precipitation": 1.7,
        "precipitation_probability": 99,
        "wind_speed": 6.9,
        "wind_bearing": 160,
    }


def test_condition_from_code_or_text() -> None:
    assert condition(0) == "sunny"
    assert condition(3) == "cloudy"
    assert condition(86) == "snowy"
    assert condition(99) == "hail"
    assert condition(None, "Moderate snowfall") == "snowy"
    assert condition(None, "Overcast") == "cloudy"
    assert condition(None, "Something else") is None
    assert condition(True) is None
