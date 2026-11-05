"""Tests for the config, reauth, reconfigure and options flows."""

from __future__ import annotations

from homeassistant import config_entries
from homeassistant.const import CONF_API_KEY
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.snowsure.const import (
    CONF_COUNTRY,
    CONF_POWDER_BAND,
    CONF_POWDER_DAYS,
    CONF_POWDER_THRESHOLD_CM,
    CONF_RESORT,
    CONF_RESORT_NAME,
    CONF_SCAN_INTERVAL_MINUTES,
    CONF_WEBCAMS,
    DOMAIN,
)

from .conftest import RESORT_URL, RESORTS_URL, SLUG


async def _start(hass: HomeAssistant):
    return await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})


async def test_full_flow_without_key(hass: HomeAssistant, mock_api: AiohttpClientMocker) -> None:
    result = await _start(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["step_id"] == "country"
    countries = result["data_schema"].schema[CONF_COUNTRY].config["options"]
    assert "Switzerland" in countries
    assert "Nowhere" not in countries  # only came from a row with an invalid slug

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_COUNTRY: "Switzerland"})
    assert result["step_id"] == "resort"
    options = result["data_schema"].schema[CONF_RESORT].config["options"]
    assert options == [{"value": SLUG, "label": "Matterhorn Ski Paradise"}]

    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_RESORT: SLUG})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Matterhorn Ski Paradise"
    assert result["data"] == {
        CONF_RESORT: SLUG,
        CONF_RESORT_NAME: "Matterhorn Ski Paradise",
        CONF_COUNTRY: "Switzerland",
    }
    assert result["result"].unique_id == SLUG


async def test_flow_stores_key(hass: HomeAssistant, mock_api: AiohttpClientMocker) -> None:
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_API_KEY: " test-key "})
    assert mock_api.mock_calls[-1][3]["Authorization"] == "Bearer test-key"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_COUNTRY: "Switzerland"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_RESORT: SLUG})
    assert result["data"][CONF_API_KEY] == "test-key"


async def test_cannot_connect_is_retryable(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(RESORTS_URL, status=503)
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "cannot_connect"}


async def test_invalid_auth(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(RESORTS_URL, status=401)
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_API_KEY: "bad"})
    assert result["errors"] == {"base": "invalid_auth"}


async def test_empty_catalogue(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker) -> None:
    aioclient_mock.get(RESORTS_URL, json={"data": []})
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["errors"] == {"base": "no_resorts"}


async def test_already_configured(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    mock_entry.add_to_hass(hass)
    result = await _start(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_COUNTRY: "Switzerland"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_RESORT: SLUG})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_reconfigure_adds_and_removes_key(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    mock_entry.add_to_hass(hass)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done()

    result = await mock_entry.start_reconfigure_flow(hass)
    assert result["step_id"] == "reconfigure"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_API_KEY: "new-key"})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert mock_entry.data[CONF_API_KEY] == "new-key"
    await hass.async_block_till_done()

    result = await mock_entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["reason"] == "reconfigure_successful"
    assert CONF_API_KEY not in mock_entry.data
    assert mock_entry.data[CONF_RESORT] == SLUG


async def test_reauth_rejected_key(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    mock_entry.add_to_hass(hass)
    aioclient_mock.get(RESORT_URL, status=401)
    result = await mock_entry.start_reauth_flow(hass)
    assert result["step_id"] == "reauth_confirm"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_API_KEY: "still-bad"})
    assert result["errors"] == {"base": "invalid_auth"}


async def test_options_flow(hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry) -> None:
    mock_entry.add_to_hass(hass)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(mock_entry.entry_id)
    assert result["step_id"] == "init"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            CONF_SCAN_INTERVAL_MINUTES: 60,
            CONF_POWDER_THRESHOLD_CM: 20,
            CONF_POWDER_DAYS: 3,
            CONF_POWDER_BAND: "summit",
        },
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert mock_entry.options == {
        CONF_SCAN_INTERVAL_MINUTES: 60,
        CONF_POWDER_THRESHOLD_CM: 20.0,
        CONF_POWDER_DAYS: 3,
        CONF_POWDER_BAND: "summit",
        # The form pre-ticks the first three; saving keeps them.
        CONF_WEBCAMS: ["matterhorn_glacier_paradise_3883m", "hohtalli_3273m", "gornergrat_3135m"],
    }
    assert mock_entry.runtime_data.update_interval.total_seconds() == 3600


async def test_options_flow_picks_up_to_three_webcams(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    mock_entry.add_to_hass(hass)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done()
    base = {
        CONF_SCAN_INTERVAL_MINUTES: 30,
        CONF_POWDER_THRESHOLD_CM: 15,
        CONF_POWDER_DAYS: 2,
        CONF_POWDER_BAND: "mid",
    }

    result = await hass.config_entries.options.async_init(mock_entry.entry_id)
    options = result["data_schema"].schema[CONF_WEBCAMS].config["options"]
    assert [option["label"] for option in options][:2] == ["Matterhorn Glacier Paradise (3883m)", "Hohtälli (3273m)"]
    assert len(options) == 5

    four = ["wolf_creek_style", "rothorn_3104m", "gornergrat_3135m", "hohtalli_3273m"]
    result = await hass.config_entries.options.async_configure(result["flow_id"], {**base, CONF_WEBCAMS: four})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {CONF_WEBCAMS: "too_many_webcams"}

    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {**base, CONF_WEBCAMS: ["wolf_creek_style", "rothorn_3104m"]}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    # SnowSure's order, not the order they were ticked in.
    assert mock_entry.options[CONF_WEBCAMS] == ["rothorn_3104m", "wolf_creek_style"]
