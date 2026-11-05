"""Data update coordinator for the SnowSure integration."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
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
    DOMAIN,
    MAX_SCAN_INTERVAL_MINUTES,
    MIN_SCAN_INTERVAL_MINUTES,
)
from .parser import parse_resort

_LOGGER = logging.getLogger(__package__)

type SnowsureConfigEntry = ConfigEntry[SnowsureCoordinator]

# The bluebird list covers every resort, so all entries share one copy.
BLUEBIRD_MAX_AGE = timedelta(minutes=DEFAULT_SCAN_INTERVAL_MINUTES)
# A locked snowpack (no Pro or My Mountains for this resort) is asked again once a day.
SNOWPACK_LOCKED_RETRY = timedelta(days=1)


@dataclass
class _SharedBluebird:
    """SnowSure's global bluebird list, fetched once for all resorts."""

    data: list[dict[str, Any]] | None = None
    fetched_at: datetime | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def async_get(self, client: SnowsureClient) -> list[dict[str, Any]] | None:
        async with self.lock:
            now = dt_util.utcnow()
            if self.fetched_at is None or now - self.fetched_at >= BLUEBIRD_MAX_AGE:
                # A failure also counts as a fetch, so an outage costs one
                # request per interval, not one per resort.
                self.fetched_at = now
                try:
                    self.data = await client.async_get_bluebird_predictions()
                except SnowsureError as err:
                    _LOGGER.debug("Bluebird predictions unavailable: %s", err)
            return self.data


def _shared_bluebird(hass: HomeAssistant) -> _SharedBluebird:
    return hass.data.setdefault(DOMAIN, {}).setdefault("bluebird", _SharedBluebird())


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


class SnowsureCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Fetch one resort (detail plus the optional sources) per poll interval."""

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
        self._snowpack: dict[str, Any] | None = None
        self._snowpack_retry_at: datetime | None = None

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

        # Optional, like the bulletin: how the forecast changed since yesterday.
        try:
            runs: dict[str, Any] | None = await self.client.async_get_forecast_runs(self.slug)
        except SnowsureError as err:
            _LOGGER.debug("Forecast runs for %s unavailable: %s", self.slug, err)
            runs = None

        bluebird = await _shared_bluebird(self.hass).async_get(self.client)
        snowpack = await self._async_snowpack()

        return parse_resort(detail, avalanche, forecast_runs=runs, bluebird=bluebird, snowpack=snowpack)

    async def _async_snowpack(self) -> dict[str, Any] | None:
        """The snowpack model's surface label; locked for resorts the key does not cover.

        A locked answer stays locked until the key changes (which reloads the
        entry), so it is kept for a day instead of being asked every refresh.
        """
        now = dt_util.utcnow()
        if self._snowpack_retry_at is not None and now < self._snowpack_retry_at:
            return self._snowpack
        try:
            self._snowpack = await self.client.async_get_snowpack(self.slug)
        except SnowsureError as err:
            _LOGGER.debug("Snowpack for %s unavailable: %s", self.slug, err)
            self._snowpack = None
        locked = bool(self._snowpack and self._snowpack.get("locked"))
        self._snowpack_retry_at = now + SNOWPACK_LOCKED_RETRY if locked else None
        return self._snowpack
