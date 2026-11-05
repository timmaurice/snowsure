"""Image entities: the resort's title photo, its webcams and its trail maps."""

from __future__ import annotations

from typing import Any

from homeassistant.components.image import ImageEntity, ImageEntityDescription
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util
from homeassistant.util import slugify

from .const import CONF_WEBCAMS, DOMAIN
from .coordinator import SnowsureConfigEntry, SnowsureCoordinator
from .entity import SnowsureEntity
from .parser import picked_webcams, webcam_key

PARALLEL_UPDATES = 0

RESORT_IMAGE = ImageEntityDescription(key="resort_image", translation_key="resort_image")


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SnowsureConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    entities: list[ImageEntity] = []
    if coordinator.data.get("image"):
        entities.append(SnowsureResortImage(coordinator, RESORT_IMAGE))
    # Webcams are created from the first refresh, only the picked ones; one
    # SnowSure adds later can be picked after the next reload of the entry.
    cams = coordinator.data.get("webcams") or []
    picked = picked_webcams(entry.options.get(CONF_WEBCAMS), cams)
    _forget_unpicked_webcams(hass, entry, picked)
    for index, cam in enumerate(cams):
        key = webcam_key(cam["name"])
        if key in picked:
            description = ImageEntityDescription(key=f"webcam_{key}", translation_key="webcam")
            entities.append(SnowsureWebcam(coordinator, description, cam["name"], index))
    # Trail maps are static and only downloaded when someone opens them.
    for index, trail_map in enumerate(coordinator.data.get("trail_maps") or []):
        description = ImageEntityDescription(
            key=f"trail_map_{slugify(trail_map['label'])}", translation_key="trail_map"
        )
        entities.append(SnowsureTrailMap(coordinator, description, trail_map["label"], index))
    async_add_entities(entities)


def _forget_unpicked_webcams(hass: HomeAssistant, entry: SnowsureConfigEntry, picked: set[str]) -> None:
    """Drop registry entries of webcams no longer picked; make sure every picked one is enabled.

    A picked webcam can be disabled in two ways: older versions created every
    webcam and disabled all but the first three, and Home Assistant restores
    a removed entity with its old disabled_by when it comes back. So restore
    picked ones from the deleted entities here and enable them before the
    platform adds them.
    """
    registry = er.async_get(hass)
    prefix = f"{entry.unique_id}_webcam_"
    for reg in er.async_entries_for_config_entry(registry, entry.entry_id):
        is_webcam = reg.domain == "image" and reg.unique_id.startswith(prefix)
        if is_webcam and reg.unique_id.removeprefix(prefix) not in picked:
            registry.async_remove(reg.entity_id)
    for key in picked:
        unique_id = f"{prefix}{key}"
        entity_id = registry.async_get_entity_id("image", DOMAIN, unique_id)
        if entity_id is None and ("image", DOMAIN, unique_id) in registry.deleted_entities:
            entity_id = registry.async_get_or_create("image", DOMAIN, unique_id, config_entry=entry).entity_id
        if entity_id is not None and (reg := registry.async_get(entity_id)) and reg.disabled_by is not None:
            registry.async_update_entity(entity_id, disabled_by=None)


class SnowsureImageBase(SnowsureEntity, ImageEntity):
    """An image fetched by Home Assistant and served through its image proxy."""

    def __init__(self, coordinator: SnowsureCoordinator, description: ImageEntityDescription) -> None:
        SnowsureEntity.__init__(self, coordinator, description)
        ImageEntity.__init__(self, coordinator.hass, verify_ssl=True)
        self._attr_image_url = self._current_url()
        self._attr_image_last_updated = dt_util.utcnow()

    def _current_url(self) -> str | None:
        raise NotImplementedError

    @property
    def available(self) -> bool:
        return super().available and self._attr_image_url is not None


class SnowsureStaticImage(SnowsureImageBase):
    """An image whose URL changes when its content does (a new photo, a new season's map)."""

    @callback
    def _handle_coordinator_update(self) -> None:
        url = self._current_url()
        if url != self._attr_image_url:
            self._attr_image_url = url
            self._cached_image = None
            self._attr_image_last_updated = dt_util.utcnow()
        super()._handle_coordinator_update()


class SnowsureResortImage(SnowsureStaticImage):
    """The resort's title photo."""

    def _current_url(self) -> str | None:
        return self.coordinator.data.get("image")


class SnowsureTrailMap(SnowsureStaticImage):
    """One trail map, as SnowSure's rendered preview of the PDF."""

    def __init__(
        self, coordinator: SnowsureCoordinator, description: ImageEntityDescription, label: str, index: int
    ) -> None:
        self._label = label
        self._index = index
        super().__init__(coordinator, description)
        self._attr_translation_placeholders = {"name": label}

    def _map(self) -> dict[str, Any] | None:
        return next((m for m in self.coordinator.data.get("trail_maps") or [] if m["label"] == self._label), None)

    def _current_url(self) -> str | None:
        trail_map = self._map()
        return trail_map["image_url"] if trail_map else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        trail_map = self._map() or {}
        return {
            "label": self._label,
            "pdf_url": trail_map.get("pdf_url"),
            "width": trail_map.get("width"),
            "height": trail_map.get("height"),
            "position": self._index,
        }


class SnowsureWebcam(SnowsureImageBase):
    """One webcam. The URL stays the same while the picture behind it changes."""

    def __init__(
        self, coordinator: SnowsureCoordinator, description: ImageEntityDescription, name: str, index: int
    ) -> None:
        self._cam_name = name
        self._index = index
        super().__init__(coordinator, description)
        self._attr_translation_placeholders = {"name": name}

    def _cam(self) -> dict[str, Any] | None:
        return next((cam for cam in self.coordinator.data.get("webcams") or [] if cam["name"] == self._cam_name), None)

    def _current_url(self) -> str | None:
        cam = self._cam()
        return cam["image_url"] if cam else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        cam = self._cam() or {}
        return {
            "camera": self._cam_name,
            "page_url": cam.get("page_url"),
            "credit": cam.get("credit"),
            "position": self._index,
        }

    @callback
    def _handle_coordinator_update(self) -> None:
        # ImageEntity keeps the first download forever unless told otherwise:
        # drop it once per refresh so the dashboard sees a current picture.
        self._attr_image_url = self._current_url()
        self._cached_image = None
        self._attr_image_last_updated = dt_util.utcnow()
        super()._handle_coordinator_update()
