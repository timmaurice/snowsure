"""Base entity for SnowSure."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity import EntityDescription
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import ATTRIBUTION, BASE_URL, CONF_RESORT_NAME, DOMAIN
from .coordinator import SnowsureCoordinator


class SnowsureEntity(CoordinatorEntity[SnowsureCoordinator]):
    """One value of one resort, grouped under a service device per resort."""

    # SnowSure's terms require the credit wherever the data is shown.
    _attr_attribution = ATTRIBUTION
    _attr_has_entity_name = True

    def __init__(self, coordinator: SnowsureCoordinator, description: EntityDescription) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        slug = coordinator.slug
        self._attr_unique_id = f"{slug}_{description.key}"

        data = coordinator.data or {}
        entry_data = coordinator.config_entry.data
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, slug)},
            name=data.get("name") or entry_data.get(CONF_RESORT_NAME) or slug,
            manufacturer="SnowSure",
            model=", ".join(part for part in (data.get("country"), data.get("region")) if part) or None,
            configuration_url=data.get("url") or f"{BASE_URL}/resorts/{slug}",
            entry_type=DeviceEntryType.SERVICE,
        )
