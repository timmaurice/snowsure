"""Calendar: season opening and closing, and the powder days in the forecast."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from homeassistant.components.calendar import CalendarEntity, CalendarEntityDescription, CalendarEvent
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .binary_sensor import powder_settings
from .coordinator import SnowsureConfigEntry
from .entity import SnowsureEntity
from .parser import bluebird_days

PARALLEL_UPDATES = 0

# Event texts follow the server language; the calendar has no translation
# hook for event summaries.
_TEXT = {
    "en": {
        "opening": "{resort}: season opens",
        "closing": "{resort}: season ends",
        "powder": "{resort}: powder day, {amount} cm new snow",
        "powder_detail": "SnowSure forecast at {elevation}, threshold {threshold} cm.",
        "bluebird": "{resort}: bluebird day",
        "bluebird_detail": "Sun after {amount} cm new snow.",
    },
    "de": {
        "opening": "{resort}: Saisonstart",
        "closing": "{resort}: Saisonende",
        "powder": "{resort}: Powder-Tag, {amount} cm Neuschnee",
        "powder_detail": "SnowSure-Prognose auf {elevation}, Schwelle {threshold} cm.",
        "bluebird": "{resort}: Bluebird-Tag",
        "bluebird_detail": "Sonne nach {amount} cm Neuschnee.",
    },
}


def _date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def resort_events(data: dict[str, Any], threshold: float, band: str, language: str = "en") -> list[CalendarEvent]:
    """All-day events: season start and end, and every forecast day reaching the powder threshold."""
    text = _TEXT.get(language.split("-")[0], _TEXT["en"])
    resort = data.get("name") or ""
    events: list[CalendarEvent] = []
    for key in ("opening", "closing"):
        if day := _date(data.get(f"season_{key}")):
            events.append(
                CalendarEvent(start=day, end=day + timedelta(days=1), summary=text[key].format(resort=resort))
            )
    elevation = (data.get("forecast_band_elevations") or {}).get(band)
    for forecast_day in data.get("forecast_daily") or []:
        amount = forecast_day.get(f"snowfall_{band}")
        if amount is None:
            amount = forecast_day.get("snowfall")
        day = _date(forecast_day.get("date"))
        if day is None or amount is None or amount < threshold:
            continue
        events.append(
            CalendarEvent(
                start=day,
                end=day + timedelta(days=1),
                summary=text["powder"].format(resort=resort, amount=f"{amount:g}"),
                description=text["powder_detail"].format(
                    elevation=f"{elevation} m" if elevation else band, threshold=f"{threshold:g}"
                ),
            )
        )
    for bluebird in bluebird_days(data.get("forecast_daily"), band, data.get("bluebird_predictions")):
        if day := _date(bluebird["date"]):
            fresh = bluebird.get("fresh_snow")
            events.append(
                CalendarEvent(
                    start=day,
                    end=day + timedelta(days=1),
                    summary=text["bluebird"].format(resort=resort),
                    description=text["bluebird_detail"].format(amount=f"{fresh:g}") if fresh is not None else None,
                )
            )
    return sorted(events, key=lambda event: event.start)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SnowsureConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    description = CalendarEntityDescription(key="calendar", translation_key="calendar", initial_color="#4a8fd4")
    async_add_entities([SnowsureCalendar(entry.runtime_data, description)])


class SnowsureCalendar(SnowsureEntity, CalendarEntity):
    """The resort's dates: season and powder days (same threshold and height as the powder alarm)."""

    def _events(self) -> list[CalendarEvent]:
        threshold, _days, band = powder_settings(self.coordinator.config_entry.options)
        return resort_events(self.coordinator.data, threshold, band, self.hass.config.language)

    @property
    def event(self) -> CalendarEvent | None:
        today = dt_util.now().date()
        return next((event for event in self._events() if event.end > today), None)

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        start, end = start_date.date(), end_date.date()
        return [event for event in self._events() if event.start < end and event.end > start]
