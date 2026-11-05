"""The snow calendar: season dates and powder days."""

from __future__ import annotations

from datetime import date

from homeassistant.components.calendar import DOMAIN as CALENDAR_DOMAIN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.snowsure.calendar import resort_events
from custom_components.snowsure.const import DOMAIN

from .conftest import SLUG

DATA = {
    "name": "Matterhorn",
    "season_opening": "2026-11-28",
    "season_closing": "2027-05-02",
    "forecast_band_elevations": {"mid": 2723},
    "forecast_daily": [
        {"date": "2026-11-05", "snowfall": 1, "snowfall_mid": 1},
        {"date": "2026-11-06", "snowfall": 20, "snowfall_mid": 18.5},
        {"date": "2026-11-07", "snowfall": 16, "snowfall_mid": None},
    ],
}


def test_events_in_order_with_powder_days() -> None:
    events = resort_events(DATA, 15, "mid", "de")
    assert [(e.start, e.summary) for e in events] == [
        (date(2026, 11, 6), "Matterhorn: Powder-Tag, 18.5 cm Neuschnee"),
        # No mid value: the forecast point stands in.
        (date(2026, 11, 7), "Matterhorn: Powder-Tag, 16 cm Neuschnee"),
        (date(2026, 11, 28), "Matterhorn: Saisonstart"),
        (date(2027, 5, 2), "Matterhorn: Saisonende"),
    ]
    assert events[0].end == date(2026, 11, 7)
    assert events[0].description == "SnowSure-Prognose auf 2723 m, Schwelle 15 cm."
    assert [e.summary for e in resort_events(DATA, 19, "mid", "en-GB")] == [
        "Matterhorn: season opens",
        "Matterhorn: season ends",
    ]


async def test_calendar_entity(hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry) -> None:
    mock_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done()

    entity_id = er.async_get(hass).async_get_entity_id(CALENDAR_DOMAIN, DOMAIN, f"{SLUG}_calendar")
    assert entity_id == "calendar.matterhorn_ski_paradise_snow_calendar"
    assert hass.states.get(entity_id) is not None

    response = await hass.services.async_call(
        CALENDAR_DOMAIN,
        "get_events",
        {"entity_id": entity_id, "start_date_time": "2026-01-01T00:00:00", "end_date_time": "2028-01-01T00:00:00"},
        blocking=True,
        return_response=True,
    )
    summaries = [event["summary"] for event in response[entity_id]["events"]]
    assert any("season" in summary for summary in summaries)
