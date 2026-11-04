"""Binary sensor: is the resort open today?"""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorEntity, BinarySensorEntityDescription
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import SnowsureConfigEntry
from .entity import SnowsureEntity

PARALLEL_UPDATES = 0

OPEN_DESCRIPTION = BinarySensorEntityDescription(key="open", translation_key="open")


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SnowsureConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities([SnowsureOpenSensor(entry.runtime_data, OPEN_DESCRIPTION)])


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
        }
