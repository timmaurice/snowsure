"""Diagnostics for SnowSure."""

from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.const import CONF_API_KEY
from homeassistant.core import HomeAssistant

from .coordinator import SnowsureConfigEntry

TO_REDACT = {CONF_API_KEY}


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: SnowsureConfigEntry) -> dict[str, Any]:
    """Return the entry (API key redacted) and the last parsed payload."""
    # getattr: runtime_data only exists once the first refresh succeeded, and a
    # failed setup is exactly when someone downloads diagnostics.
    coordinator = getattr(entry, "runtime_data", None)
    data = getattr(coordinator, "data", None)
    if isinstance(data, dict) and isinstance(data.get("forecast_daily"), list):
        data = {**data, "forecast_daily": f"<{len(data['forecast_daily'])} days>"}

    return {
        "entry": {
            "version": entry.version,
            "unique_id": entry.unique_id,
            "title": entry.title,
            "data": async_redact_data(dict(entry.data), TO_REDACT),
            "options": dict(entry.options),
            "has_api_key": bool(entry.data.get(CONF_API_KEY)),
        },
        "coordinator": {
            "last_update_success": getattr(coordinator, "last_update_success", None),
            "update_interval": str(getattr(coordinator, "update_interval", None)),
            "data": data,
        },
    }
