"""The SnowSure integration."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any

from homeassistant.components.http import StaticPathConfig
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, Platform
from homeassistant.core import CoreState, Event, HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .coordinator import SnowsureConfigEntry, SnowsureCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.CALENDAR,
    Platform.IMAGE,
    Platform.SENSOR,
    Platform.WEATHER,
]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

# The Lovelace card is built from frontend/ into this package and served by the
# integration itself, so installing the integration is all a user has to do.
CARD_FILENAME = "snowsure-card.js"
CARD_URL_PREFIX = "/snowsure_frontend/"


def card_digest(path: Path) -> str:
    """First 8 hex digits of the card's SHA-256, or "missing" without a build."""
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()[:8]
    except OSError:
        return "missing"


async def _async_reconcile_card_resource(resources: Any, new_url: str) -> None:
    """Leave exactly one Lovelace resource pointing at the bundled card.

    The resource store loads lazily: before it is loaded async_items() is
    empty, and registering against that list would add a duplicate on every
    restart.
    """
    if not getattr(resources, "loaded", False):
        await resources.async_load()
        resources.loaded = True

    own = [item for item in resources.async_items() if item.get("url", "").startswith(CARD_URL_PREFIX)]

    if not own:
        _LOGGER.info("Registering Lovelace resource %s", new_url)
        await resources.async_create_item({"res_type": "module", "url": new_url})
        return

    for duplicate in own[1:]:
        _LOGGER.info("Removing duplicate Lovelace resource %s", duplicate.get("url"))
        await resources.async_delete_item(duplicate.get("id"))

    if own[0].get("url") != new_url:
        _LOGGER.debug("Updating Lovelace resource URL to %s", new_url)
        await resources.async_update_item(own[0].get("id"), {"url": new_url})


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the bundled card and register it as a Lovelace resource."""
    integration = await async_get_integration(hass, DOMAIN)
    version = integration.version or "0.0.0"

    card_path = Path(__file__).parent / CARD_FILENAME
    await hass.http.async_register_static_paths(
        [StaticPathConfig(f"{CARD_URL_PREFIX}{CARD_FILENAME}", str(card_path), cache_headers=True)]
    )
    # The static path is served with long cache headers, so the URL has to
    # change whenever the file does. The version alone stays the same across
    # rebuilds during development (and across a re-pushed tag); the content
    # hash does not.
    digest = await hass.async_add_executor_job(card_digest, card_path)
    new_url = f"{CARD_URL_PREFIX}{CARD_FILENAME}?v={version}-{digest}"

    async def _async_register(_event: Event | None = None) -> None:
        lovelace = hass.data.get("lovelace")
        if lovelace is None:
            _LOGGER.debug("Lovelace not loaded; add %s as a resource by hand", new_url)
            return
        if getattr(lovelace, "resource_mode", "storage") != "storage":
            _LOGGER.info("Lovelace resources are in YAML mode; add %s as a module resource by hand", new_url)
            return
        resources = getattr(lovelace, "resources", None)
        if resources is None:
            return
        try:
            await _async_reconcile_card_resource(resources, new_url)
        except Exception as err:  # noqa: BLE001 - must never break setup
            _LOGGER.warning("Could not register the SnowSure card resource: %s", err)

    if hass.state is CoreState.running:
        hass.async_create_task(_async_register())
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _async_register)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: SnowsureConfigEntry) -> bool:
    """Set up one SnowSure resort from a config entry.

    No update listener: the options flow reloads itself (OptionsFlowWithReload),
    and a listener next to the reconfigure step's async_update_reload_and_abort
    is a usage error from core 2026.12 on (and reloads twice before that).
    """
    coordinator = SnowsureCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: SnowsureConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
