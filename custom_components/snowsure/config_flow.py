"""Config flow for SnowSure: optional API key -> country -> resort."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlowWithReload
from homeassistant.const import CONF_API_KEY
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import ResortSummary, SnowsureAuthError, SnowsureClient, SnowsureError
from .const import (
    CONF_COUNTRY,
    CONF_POWDER_BAND,
    CONF_POWDER_DAYS,
    CONF_POWDER_THRESHOLD_CM,
    CONF_RESORT,
    CONF_RESORT_NAME,
    CONF_SCAN_INTERVAL_MINUTES,
    DEFAULT_POWDER_BAND,
    DEFAULT_POWDER_DAYS,
    DEFAULT_POWDER_THRESHOLD_CM,
    DEFAULT_SCAN_INTERVAL_MINUTES,
    DOMAIN,
    MAX_POWDER_DAYS,
    MAX_SCAN_INTERVAL_MINUTES,
    MIN_SCAN_INTERVAL_MINUTES,
    POWDER_BANDS,
)

_API_KEY_SELECTOR = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))


def _api_key_schema() -> vol.Schema:
    # Optional: the read API is public. A key only identifies a SnowSure Pro
    # caller, which unlocks the 14-day forecast. The stored key is never
    # suggested back into a form.
    return vol.Schema({vol.Optional(CONF_API_KEY): _API_KEY_SELECTOR})


def _clean_key(user_input: Mapping[str, Any]) -> str | None:
    return (user_input.get(CONF_API_KEY) or "").strip() or None


class SnowsureConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add one resort per config entry."""

    VERSION = 1

    def __init__(self) -> None:
        self._api_key: str | None = None
        self._resorts: list[ResortSummary] = []
        self._country: str | None = None

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> SnowsureOptionsFlow:
        return SnowsureOptionsFlow()

    async def _async_fetch_resorts(self, api_key: str | None) -> str | None:
        """Load the catalogue; return an error key or None."""
        client = SnowsureClient(async_get_clientsession(self.hass), api_key)
        try:
            self._resorts = await client.async_get_resorts()
        except SnowsureAuthError:
            return "invalid_auth"
        except SnowsureError:
            return "cannot_connect"
        if not self._resorts:
            return "no_resorts"
        return None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Ask for the optional API key and load the resort catalogue."""
        errors: dict[str, str] = {}
        if user_input is not None:
            self._api_key = _clean_key(user_input)
            if error := await self._async_fetch_resorts(self._api_key):
                errors["base"] = error
            else:
                return await self.async_step_country()

        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(_api_key_schema(), user_input or {}),
            errors=errors,
            description_placeholders={"developers_url": "https://www.snowsure.ai/developers"},
        )

    async def async_step_country(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Narrow ~580 resorts down by country."""
        if user_input is not None:
            self._country = user_input[CONF_COUNTRY]
            return await self.async_step_resort()

        countries = sorted({resort.country for resort in self._resorts if resort.country})
        return self.async_show_form(
            step_id="country",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_COUNTRY): SelectSelector(
                        SelectSelectorConfig(options=countries, mode=SelectSelectorMode.DROPDOWN, sort=True)
                    )
                }
            ),
        )

    async def async_step_resort(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Pick the resort; its slug becomes the entry's unique_id."""
        in_country = {resort.slug: resort for resort in self._resorts if resort.country == self._country}

        if user_input is not None:
            resort = in_country.get(user_input[CONF_RESORT])
            if resort is not None:
                await self.async_set_unique_id(resort.slug)
                self._abort_if_unique_id_configured()
                data: dict[str, Any] = {
                    CONF_RESORT: resort.slug,
                    CONF_RESORT_NAME: resort.name,
                    CONF_COUNTRY: resort.country,
                }
                if self._api_key:
                    data[CONF_API_KEY] = self._api_key
                return self.async_create_entry(title=resort.name, data=data)

        options = [
            SelectOptionDict(value=resort.slug, label=resort.name)
            for resort in sorted(in_country.values(), key=lambda r: r.name.casefold())
        ]
        return self.async_show_form(
            step_id="resort",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_RESORT): SelectSelector(
                        SelectSelectorConfig(options=options, mode=SelectSelectorMode.DROPDOWN)
                    )
                }
            ),
            description_placeholders={"country": self._country or ""},
            last_step=True,
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        """SnowSure rejected the stored key."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return await self._async_step_update_key("reauth_confirm", self._get_reauth_entry(), user_input)

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Add, change or remove the API key of an existing entry."""
        return await self._async_step_update_key("reconfigure", self._get_reconfigure_entry(), user_input)

    async def _async_step_update_key(
        self, step_id: str, entry: ConfigEntry, user_input: dict[str, Any] | None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            api_key = _clean_key(user_input)
            client = SnowsureClient(async_get_clientsession(self.hass), api_key)
            try:
                # The resort detail is the cheap request that carries the key's
                # entitlement, so it doubles as the key check.
                await client.async_get_resort(entry.data[CONF_RESORT])
            except SnowsureAuthError:
                errors["base"] = "invalid_auth"
            except SnowsureError:
                errors["base"] = "cannot_connect"
            else:
                data = {k: v for k, v in entry.data.items() if k != CONF_API_KEY}
                if api_key:
                    data[CONF_API_KEY] = api_key
                return self.async_update_reload_and_abort(entry, data=data)

        return self.async_show_form(
            step_id=step_id,
            data_schema=_api_key_schema(),
            errors=errors,
            description_placeholders={
                "resort": entry.title,
                "developers_url": "https://www.snowsure.ai/developers",
            },
        )


class SnowsureOptionsFlow(OptionsFlowWithReload):
    """Poll interval and powder alarm; it reloads the entry itself after saving.

    The API key changes the setup itself, so it lives in reconfigure. A
    different resort is a different entry: the slug is the unique_id, and
    swapping it under existing entities would splice two resorts' history.
    """

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(
                data={
                    CONF_SCAN_INTERVAL_MINUTES: int(user_input[CONF_SCAN_INTERVAL_MINUTES]),
                    CONF_POWDER_THRESHOLD_CM: float(user_input[CONF_POWDER_THRESHOLD_CM]),
                    CONF_POWDER_DAYS: int(user_input[CONF_POWDER_DAYS]),
                    CONF_POWDER_BAND: user_input[CONF_POWDER_BAND],
                }
            )

        options = self.config_entry.options
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SCAN_INTERVAL_MINUTES,
                        default=options.get(CONF_SCAN_INTERVAL_MINUTES, DEFAULT_SCAN_INTERVAL_MINUTES),
                    ): NumberSelector(
                        NumberSelectorConfig(
                            min=MIN_SCAN_INTERVAL_MINUTES,
                            max=MAX_SCAN_INTERVAL_MINUTES,
                            step=5,
                            mode=NumberSelectorMode.BOX,
                            unit_of_measurement="min",
                        )
                    ),
                    vol.Required(
                        CONF_POWDER_THRESHOLD_CM,
                        default=options.get(CONF_POWDER_THRESHOLD_CM, DEFAULT_POWDER_THRESHOLD_CM),
                    ): NumberSelector(
                        NumberSelectorConfig(
                            min=1, max=100, step=1, mode=NumberSelectorMode.BOX, unit_of_measurement="cm"
                        )
                    ),
                    vol.Required(
                        CONF_POWDER_DAYS, default=options.get(CONF_POWDER_DAYS, DEFAULT_POWDER_DAYS)
                    ): NumberSelector(
                        NumberSelectorConfig(min=1, max=MAX_POWDER_DAYS, step=1, mode=NumberSelectorMode.SLIDER)
                    ),
                    vol.Required(
                        CONF_POWDER_BAND, default=options.get(CONF_POWDER_BAND, DEFAULT_POWDER_BAND)
                    ): SelectSelector(
                        SelectSelectorConfig(
                            options=list(POWDER_BANDS),
                            mode=SelectSelectorMode.DROPDOWN,
                            translation_key="powder_band",
                        )
                    ),
                }
            ),
        )
