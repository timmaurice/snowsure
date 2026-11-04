"""Data update coordinator for the SnowSure integration."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_API_KEY
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import (
    SnowsureAuthError,
    SnowsureClient,
    SnowsureError,
    SnowsureNotFoundError,
    SnowsureRateLimitError,
)
from .const import (
    CONF_RESORT,
    CONF_SCAN_INTERVAL_MINUTES,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    MAX_SCAN_INTERVAL_MINUTES,
    MIN_SCAN_INTERVAL_MINUTES,
)
from .parser import parse_resort, parse_snowfall_history

_LOGGER = logging.getLogger(__package__)

type SnowsureConfigEntry = ConfigEntry[SnowsureCoordinator]


def async_scan_interval(entry: ConfigEntry) -> timedelta:
    """Return the poll interval for an entry, honouring the options flow."""
    minutes = entry.options.get(CONF_SCAN_INTERVAL_MINUTES, DEFAULT_SCAN_INTERVAL_MINUTES)
    try:
        minutes = int(minutes)
    except TypeError, ValueError:
        minutes = DEFAULT_SCAN_INTERVAL_MINUTES
    if not MIN_SCAN_INTERVAL_MINUTES <= minutes <= MAX_SCAN_INTERVAL_MINUTES:
        # The options form is bounded, but a hand-edited value reaches this
        # reader directly.
        minutes = DEFAULT_SCAN_INTERVAL_MINUTES
    return timedelta(minutes=minutes)


# The snowfall ledger gains one day a day; a few refreshes a day keep it current
# without spending a request on every poll.
HISTORY_MAX_AGE = timedelta(hours=3)


class SnowsureCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Fetch one resort (detail + avalanche bulletin, snowfall history now and then) per poll interval."""

    config_entry: SnowsureConfigEntry

    def __init__(self, hass: HomeAssistant, entry: SnowsureConfigEntry) -> None:
        self.slug: str = entry.data[CONF_RESORT]
        self.client = SnowsureClient(async_get_clientsession(hass), entry.data.get(CONF_API_KEY))
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"snowsure_{self.slug}",
            update_interval=async_scan_interval(entry),
        )
        self._history: list[dict[str, Any]] | None = None
        self._history_at: datetime | None = None

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            detail = await self.client.async_get_resort(self.slug)
        except SnowsureAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except SnowsureNotFoundError as err:
            raise UpdateFailed(
                f"SnowSure does not know the resort '{self.slug}' any more. Remove and re-add it."
            ) from err
        except SnowsureRateLimitError as err:
            raise UpdateFailed(str(err), retry_after=err.retry_after) from err
        except SnowsureError as err:
            raise UpdateFailed(str(err)) from err

        # The bulletin is a separate, optional source: losing it must not take
        # the snow sensors down with it.
        try:
            avalanche: dict[str, Any] | None = await self.client.async_get_avalanche(self.slug)
        except SnowsureError as err:
            _LOGGER.debug("Avalanche bulletin for %s unavailable: %s", self.slug, err)
            avalanche = None

        data = parse_resort(detail, avalanche)
        data["snowfall_history"] = await self._async_history()
        return data

    async def _async_history(self) -> list[dict[str, Any]] | None:
        """Past days' snowfall, refetched every HISTORY_MAX_AGE; optional like the bulletin."""
        now = dt_util.utcnow()
        if self._history_at is not None and now - self._history_at < HISTORY_MAX_AGE:
            return self._history
        try:
            payload = await self.client.async_get_snowfall_history(self.slug)
        except SnowsureError as err:
            _LOGGER.debug("Snowfall history for %s unavailable: %s", self.slug, err)
            # Keep the last good ledger; try again on the next poll.
            return self._history
        self._history = parse_snowfall_history(payload)
        self._history_at = now
        return self._history
