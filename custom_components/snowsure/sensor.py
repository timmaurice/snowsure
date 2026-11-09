"""Sensors for one SnowSure resort."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfLength, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .coordinator import SnowsureConfigEntry
from .entity import SnowsureEntity

PARALLEL_UPDATES = 0

Data = dict[str, Any]


@dataclass(frozen=True, kw_only=True)
class SnowsureSensorEntityDescription(SensorEntityDescription):
    """A sensor reading one key of the coordinator payload."""

    value_fn: Callable[[Data], Any]
    attrs_fn: Callable[[Data], dict[str, Any]] | None = None


def _key(name: str) -> Callable[[Data], Any]:
    return lambda data: data.get(name)


def _date(name: str) -> Callable[[Data], date | None]:
    return lambda data: dt_util.parse_date(data[name]) if data.get(name) else None


def _timestamp(name: str) -> Callable[[Data], datetime | None]:
    return lambda data: dt_util.parse_datetime(data[name]) if data.get(name) else None


def _depth(key: str, translation_key: str, precision: int = 0, **kwargs: Any) -> SnowsureSensorEntityDescription:
    """A snow height in centimetres; HA converts to inches if the user asks.

    Snow depths read in whole centimetres; new snow and forecasts are small
    numbers where the first decimal matters, so they pass ``precision=1``.
    """
    kwargs.setdefault("value_fn", _key(key))
    return SnowsureSensorEntityDescription(
        key=key,
        translation_key=translation_key,
        device_class=SensorDeviceClass.DISTANCE,
        native_unit_of_measurement=UnitOfLength.CENTIMETERS,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=precision,
        **kwargs,
    )


def _temperature(key: str, translation_key: str, **kwargs: Any) -> SnowsureSensorEntityDescription:
    return SnowsureSensorEntityDescription(
        key=key,
        translation_key=translation_key,
        value_fn=_key(key),
        device_class=SensorDeviceClass.TEMPERATURE,
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
        **kwargs,
    )


SENSORS: tuple[SnowsureSensorEntityDescription, ...] = (
    SnowsureSensorEntityDescription(
        key="score",
        translation_key="score",
        value_fn=_key("score"),
        state_class=SensorStateClass.MEASUREMENT,
        attrs_fn=lambda d: {
            "rating": d.get("rating"),
            "rating_color": d.get("rating_color"),
            "tagline": d.get("tagline"),
            "trend": d.get("trend"),
            "breakdown": d.get("score_breakdown"),
        },
    ),
    _depth(
        "depth_base",
        "depth_base",
        attrs_fn=lambda d: {
            "vs_average_pct": d.get("depth_vs_average_pct"),
            "source": d.get("depth_source"),
            "elevation": d.get("elevation_base"),
        },
    ),
    _depth("depth_mid", "depth_mid", entity_registry_enabled_default=False),
    _depth("depth_summit", "depth_summit", attrs_fn=lambda d: {"elevation": d.get("elevation_summit")}),
    _depth("snowfall_24h", "snowfall_24h", precision=1),
    _depth("snowfall_48h", "snowfall_48h", precision=1, entity_registry_enabled_default=False),
    _depth("snowfall_72h", "snowfall_72h", precision=1, entity_registry_enabled_default=False),
    _depth("snowfall_7d", "snowfall_7d", precision=1),
    _depth("snowfall_season", "snowfall_season"),
    _depth(
        "forecast_7d",
        "forecast_7d",
        precision=1,
        attrs_fn=lambda d: {
            "horizon_days": d.get("forecast_horizon_days"),
            "peak_date": d.get("forecast_peak_date"),
            "peak_snowfall": d.get("forecast_peak_snowfall"),
            # Per-day values are centimetres / degrees Celsius regardless of the
            # unit the user picked for this sensor.
            "daily": d.get("forecast_daily"),
            "point_band": d.get("forecast_point_band"),
            "band_elevations": d.get("forecast_band_elevations"),
            "change_24h": d.get("forecast_change_24h"),
            "change_48h": d.get("forecast_change_48h"),
        },
    ),
    # Only filled when the caller is entitled to more than seven days.
    _depth(
        "forecast_14d",
        "forecast_14d",
        precision=1,
        entity_registry_enabled_default=False,
        attrs_fn=lambda d: {"horizon_days": d.get("forecast_horizon_days")},
    ),
    SnowsureSensorEntityDescription(
        key="forecast_confidence",
        translation_key="forecast_confidence",
        value_fn=_key("forecast_confidence"),
        device_class=SensorDeviceClass.ENUM,
        options=["low", "medium", "high"],
        attrs_fn=lambda d: {
            "score": d.get("forecast_confidence_score"),
            "spread": d.get("forecast_confidence_spread"),
            "models": d.get("forecast_confidence_models"),
            "week2": d.get("forecast_confidence_week2"),
        },
    ),
    SnowsureSensorEntityDescription(
        key="lifts_open",
        translation_key="lifts_open",
        value_fn=_key("lifts_open"),
        state_class=SensorStateClass.MEASUREMENT,
        attrs_fn=lambda d: {"total": d.get("lifts_total")},
    ),
    SnowsureSensorEntityDescription(
        key="runs_open",
        translation_key="runs_open",
        value_fn=_key("runs_open"),
        state_class=SensorStateClass.MEASUREMENT,
        attrs_fn=lambda d: {"total": d.get("runs_total")},
    ),
    SnowsureSensorEntityDescription(
        key="terrain_open",
        translation_key="terrain_open",
        value_fn=_key("terrain_open_pct"),
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        entity_registry_enabled_default=False,
    ),
    _temperature("temperature_base", "temperature_base"),
    _temperature("temperature_mid", "temperature_mid", entity_registry_enabled_default=False),
    _temperature("temperature_summit", "temperature_summit"),
    SnowsureSensorEntityDescription(
        key="weather",
        translation_key="weather",
        value_fn=_key("weather"),
    ),
    SnowsureSensorEntityDescription(
        key="snow_quality",
        translation_key="snow_quality",
        value_fn=_key("snow_quality"),
        attrs_fn=lambda d: {
            "description": d.get("snow_quality_description"),
            # "snowpack": SnowSure's snowpack model (mid, flat); "conditions": the resort report.
            "source": d.get("snow_quality_source"),
            "confidence": d.get("snow_quality_confidence"),
            "band": d.get("snow_quality_band"),
        },
    ),
    SnowsureSensorEntityDescription(
        key="avalanche_level",
        translation_key="avalanche_level",
        value_fn=_key("avalanche_level"),
        state_class=SensorStateClass.MEASUREMENT,
        attrs_fn=lambda d: {
            "label": d.get("avalanche_label"),
            "advice": d.get("avalanche_advice"),
            "valid_until": d.get("avalanche_valid_until"),
            "issuer": d.get("avalanche_issuer"),
            "link": d.get("avalanche_link"),
            "coverage": d.get("avalanche_coverage"),
        },
    ),
    SnowsureSensorEntityDescription(
        key="season_opening",
        translation_key="season_opening",
        value_fn=_date("season_opening"),
        device_class=SensorDeviceClass.DATE,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    SnowsureSensorEntityDescription(
        key="season_closing",
        translation_key="season_closing",
        value_fn=_date("season_closing"),
        device_class=SensorDeviceClass.DATE,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
    SnowsureSensorEntityDescription(
        key="updated_at",
        translation_key="updated_at",
        value_fn=_timestamp("updated_at"),
        # The upstream credits ride on this one sensor; the card reads them here.
        attrs_fn=lambda d: {"sources": d.get("credits") or []},
        device_class=SensorDeviceClass.TIMESTAMP,
        entity_category=EntityCategory.DIAGNOSTIC,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SnowsureConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    async_add_entities(SnowsureSensor(coordinator, description) for description in SENSORS)


class SnowsureSensor(SnowsureEntity, SensorEntity):
    """One SnowSure value."""

    entity_description: SnowsureSensorEntityDescription
    # The daily forecast changes every refresh; keeping it out of the recorder
    # stops it from bloating the database with a copy per poll. The source
    # list is long and the same every time.
    _unrecorded_attributes = frozenset({"daily", "breakdown", "advice", "sources"})

    @property
    def native_value(self) -> Any:
        return self.entity_description.value_fn(self.coordinator.data)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if self.entity_description.attrs_fn is None:
            return None
        return self.entity_description.attrs_fn(self.coordinator.data)
