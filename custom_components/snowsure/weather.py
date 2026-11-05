"""Weather entity: SnowSure's current conditions and daily forecast for a resort."""

from __future__ import annotations

from typing import Any

from homeassistant.components.weather import (
    ATTR_CONDITION_CLOUDY,
    ATTR_CONDITION_FOG,
    ATTR_CONDITION_HAIL,
    ATTR_CONDITION_LIGHTNING_RAINY,
    ATTR_CONDITION_PARTLYCLOUDY,
    ATTR_CONDITION_POURING,
    ATTR_CONDITION_RAINY,
    ATTR_CONDITION_SNOWY,
    ATTR_CONDITION_SNOWY_RAINY,
    ATTR_CONDITION_SUNNY,
    Forecast,
    WeatherEntity,
    WeatherEntityFeature,
)
from homeassistant.const import UnitOfPrecipitationDepth, UnitOfSpeed, UnitOfTemperature
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import EntityDescription
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import SnowsureConfigEntry, SnowsureCoordinator
from .entity import SnowsureEntity

PARALLEL_UPDATES = 0

# WMO weather codes (Open-Meteo, which SnowSure blends) to Home Assistant conditions.
_WMO: dict[int, str] = {
    0: ATTR_CONDITION_SUNNY,
    1: ATTR_CONDITION_SUNNY,
    2: ATTR_CONDITION_PARTLYCLOUDY,
    3: ATTR_CONDITION_CLOUDY,
    45: ATTR_CONDITION_FOG,
    48: ATTR_CONDITION_FOG,
    51: ATTR_CONDITION_RAINY,
    53: ATTR_CONDITION_RAINY,
    55: ATTR_CONDITION_RAINY,
    56: ATTR_CONDITION_SNOWY_RAINY,
    57: ATTR_CONDITION_SNOWY_RAINY,
    61: ATTR_CONDITION_RAINY,
    63: ATTR_CONDITION_RAINY,
    65: ATTR_CONDITION_POURING,
    66: ATTR_CONDITION_SNOWY_RAINY,
    67: ATTR_CONDITION_SNOWY_RAINY,
    71: ATTR_CONDITION_SNOWY,
    73: ATTR_CONDITION_SNOWY,
    75: ATTR_CONDITION_SNOWY,
    77: ATTR_CONDITION_SNOWY,
    80: ATTR_CONDITION_RAINY,
    81: ATTR_CONDITION_RAINY,
    82: ATTR_CONDITION_POURING,
    85: ATTR_CONDITION_SNOWY,
    86: ATTR_CONDITION_SNOWY,
    95: ATTR_CONDITION_LIGHTNING_RAINY,
    96: ATTR_CONDITION_HAIL,
    99: ATTR_CONDITION_HAIL,
}

# The same codes by Open-Meteo's description, for the current conditions,
# which SnowSure sends as text only.
_WMO_TEXT: dict[str, int] = {
    "clear sky": 0,
    "mainly clear": 1,
    "partly cloudy": 2,
    "overcast": 3,
    "fog": 45,
    "depositing rime fog": 48,
    "light drizzle": 51,
    "moderate drizzle": 53,
    "dense drizzle": 55,
    "light freezing drizzle": 56,
    "dense freezing drizzle": 57,
    "slight rain": 61,
    "moderate rain": 63,
    "heavy rain": 65,
    "light freezing rain": 66,
    "heavy freezing rain": 67,
    "slight snowfall": 71,
    "moderate snowfall": 73,
    "heavy snowfall": 75,
    "snow grains": 77,
    "slight rain showers": 80,
    "moderate rain showers": 81,
    "violent rain showers": 82,
    "slight snow showers": 85,
    "heavy snow showers": 86,
    "thunderstorm": 95,
    "thunderstorm with slight hail": 96,
    "thunderstorm with heavy hail": 99,
}


def condition(code: Any = None, text: str | None = None) -> str | None:
    """Home Assistant's condition for a WMO code, or for its description."""
    if isinstance(code, int | float) and not isinstance(code, bool):
        return _WMO.get(int(code))
    if text:
        mapped = _WMO_TEXT.get(text.strip().lower())
        return _WMO.get(mapped) if mapped is not None else None
    return None


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SnowsureConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities([SnowsureWeather(entry.runtime_data, EntityDescription(key="weather"))])


class SnowsureWeather(SnowsureEntity, WeatherEntity):
    """The resort's weather, named after the resort itself (weather.<resort>)."""

    _attr_name = None
    _attr_native_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_native_wind_speed_unit = UnitOfSpeed.KILOMETERS_PER_HOUR
    _attr_native_precipitation_unit = UnitOfPrecipitationDepth.MILLIMETERS
    _attr_supported_features = WeatherEntityFeature.FORECAST_DAILY

    def __init__(self, coordinator: SnowsureCoordinator, description: EntityDescription) -> None:
        super().__init__(coordinator, description)

    @property
    def condition(self) -> str | None:
        return condition(text=self.coordinator.data.get("weather"))

    @property
    def native_temperature(self) -> float | None:
        return self.coordinator.data.get("current_temperature")

    @property
    def native_wind_speed(self) -> float | None:
        return self.coordinator.data.get("current_wind_speed")

    @property
    def humidity(self) -> float | None:
        return self.coordinator.data.get("current_humidity")

    def _daily(self) -> list[Forecast]:
        return [
            Forecast(
                datetime=day["date"],
                condition=condition(day.get("weather_code"), day.get("conditions")),
                native_temperature=day.get("temp_max"),
                native_templow=day.get("temp_min"),
                native_precipitation=day.get("precipitation"),
                precipitation_probability=day.get("precipitation_probability"),
                native_wind_speed=day.get("wind_speed"),
                wind_bearing=day.get("wind_bearing"),
            )
            for day in self.coordinator.data.get("forecast_daily") or []
            if day.get("date")
        ]

    async def async_forecast_daily(self) -> list[Forecast] | None:
        return self._daily()

    @callback
    def _handle_coordinator_update(self) -> None:
        super()._handle_coordinator_update()
        # Cards subscribed to the forecast get the new days with the refresh.
        self.hass.async_create_task(self.async_update_listeners(("daily",)))
