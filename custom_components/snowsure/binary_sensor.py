"""Binary sensors: is the resort open today, and is a powder day coming?"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from homeassistant.components.binary_sensor import BinarySensorEntity, BinarySensorEntityDescription
from homeassistant.const import ATTR_LATITUDE, ATTR_LONGITUDE
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import (
    CONF_POWDER_BAND,
    CONF_POWDER_DAYS,
    CONF_POWDER_THRESHOLD_CM,
    DEFAULT_POWDER_BAND,
    DEFAULT_POWDER_DAYS,
    DEFAULT_POWDER_THRESHOLD_CM,
    MAX_POWDER_DAYS,
    POWDER_BANDS,
)
from .coordinator import SnowsureConfigEntry, SnowsureCoordinator
from .entity import SnowsureEntity
from .parser import bluebird_days

PARALLEL_UPDATES = 0

OPEN_DESCRIPTION = BinarySensorEntityDescription(key="open", translation_key="open")
POWDER_DESCRIPTION = BinarySensorEntityDescription(key="powder_alarm", translation_key="powder_alarm")
BLUEBIRD_DESCRIPTION = BinarySensorEntityDescription(key="bluebird", translation_key="bluebird")
# Bluebird days count within the coming week, today included.
BLUEBIRD_HORIZON_DAYS = 7


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SnowsureConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities(
        [
            SnowsureOpenSensor(entry.runtime_data, OPEN_DESCRIPTION),
            SnowsurePowderAlarm(entry.runtime_data, POWDER_DESCRIPTION, entry.options),
            SnowsureBluebird(entry.runtime_data, BLUEBIRD_DESCRIPTION, entry.options),
        ]
    )


class SnowsureOpenSensor(SnowsureEntity, BinarySensorEntity):
    """On while SnowSure considers the resort open."""

    @property
    def is_on(self) -> bool | None:
        return self.coordinator.data.get("is_open")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data
        return {
            "status": data.get("status"),
            "operating_today": data.get("operating_today"),
            "closure_reason": data.get("closure_reason"),
            "closure_label": data.get("closure_label"),
            "season_opening": data.get("season_opening"),
            "season_closing": data.get("season_closing"),
            "website": data.get("website"),
            "trail_map": data.get("trail_map"),
            # Puts the resort on Home Assistant's map dashboard.
            ATTR_LATITUDE: data.get("latitude"),
            ATTR_LONGITUDE: data.get("longitude"),
        }


def powder_outlook(
    daily: list[dict[str, Any]] | None, threshold: float, days: int, band: str
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """The days checked and the first of them that reaches ``threshold`` cm.

    Each day uses the snowfall at ``band`` and falls back to the forecast
    point's value when SnowSure sent no bands.
    """
    checked: list[dict[str, Any]] = []
    for day in (daily or [])[:days]:
        amount = day.get(f"snowfall_{band}")
        if amount is None:
            amount = day.get("snowfall")
        checked.append({"date": day.get("date"), "snowfall": amount})
    first = next((day for day in checked if day["snowfall"] is not None and day["snowfall"] >= threshold), None)
    return checked, first


class SnowsurePowderAlarm(SnowsureEntity, BinarySensorEntity):
    """On while a day in the look-ahead window forecasts enough new snow.

    Threshold, window and height come from the options, so an automation needs
    no template: "when the powder alarm turns on, notify me".
    """

    def __init__(
        self,
        coordinator: SnowsureCoordinator,
        description: BinarySensorEntityDescription,
        options: Mapping[str, Any],
    ) -> None:
        super().__init__(coordinator, description)
        self._threshold, self._days, self._band = powder_settings(options)

    def _outlook(self) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        return powder_outlook(self.coordinator.data.get("forecast_daily"), self._threshold, self._days, self._band)

    @property
    def is_on(self) -> bool | None:
        checked, first = self._outlook()
        if not checked:
            return None
        return first is not None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        checked, first = self._outlook()
        elevations = self.coordinator.data.get("forecast_band_elevations") or {}
        return {
            "threshold_cm": self._threshold,
            "days": self._days,
            "band": self._band,
            "elevation": elevations.get(self._band),
            "date": first["date"] if first else None,
            "snowfall": first["snowfall"] if first else None,
            "max_snowfall": max((d["snowfall"] for d in checked if d["snowfall"] is not None), default=None),
        }


def powder_settings(options: Mapping[str, Any]) -> tuple[float, int, str]:
    """Threshold (cm), days ahead and height of the powder alarm, defaults for anything invalid."""
    threshold = _option_float(options.get(CONF_POWDER_THRESHOLD_CM), DEFAULT_POWDER_THRESHOLD_CM)
    days = int(_option_float(options.get(CONF_POWDER_DAYS), DEFAULT_POWDER_DAYS))
    band = options.get(CONF_POWDER_BAND)
    return (
        threshold,
        days if 1 <= days <= MAX_POWDER_DAYS else DEFAULT_POWDER_DAYS,
        band if band in POWDER_BANDS else DEFAULT_POWDER_BAND,
    )


def _option_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except TypeError, ValueError:
        return default


class SnowsureBluebird(SnowsureEntity, BinarySensorEntity):
    """On while a bluebird day (sun after new snow) lies in the forecast's next week."""

    def __init__(
        self,
        coordinator: SnowsureCoordinator,
        description: BinarySensorEntityDescription,
        options: Mapping[str, Any],
    ) -> None:
        super().__init__(coordinator, description)
        _threshold, _days, self._band = powder_settings(options)

    def _days(self) -> list[dict[str, Any]]:
        data = self.coordinator.data
        upcoming = bluebird_days(data.get("forecast_daily"), self._band, data.get("bluebird_predictions"))
        week = {day.get("date") for day in (data.get("forecast_daily") or [])[:BLUEBIRD_HORIZON_DAYS]}
        return [day for day in upcoming if day["date"] in week]

    @property
    def is_on(self) -> bool | None:
        if not self.coordinator.data.get("forecast_daily"):
            return None
        return bool(self._days())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        days = self._days()
        first = days[0] if days else {}
        return {
            "date": first.get("date"),
            "fresh_snow": first.get("fresh_snow"),
            "source": first.get("source"),
            "confidence": first.get("confidence"),
            "band": self._band,
            "days": days,
        }
