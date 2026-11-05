"""Tests for setup, entities, failure handling and diagnostics."""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import ATTR_ATTRIBUTION, CONF_API_KEY, STATE_ON, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.snowsure.binary_sensor import powder_outlook
from custom_components.snowsure.const import (
    CONF_POWDER_BAND,
    CONF_POWDER_DAYS,
    CONF_POWDER_THRESHOLD_CM,
    CONF_SCAN_INTERVAL_MINUTES,
    CONF_WEBCAMS,
    DOMAIN,
)
from custom_components.snowsure.coordinator import async_scan_interval
from custom_components.snowsure.diagnostics import async_get_config_entry_diagnostics
from custom_components.snowsure.sensor import SENSORS

from .conftest import AVALANCHE_URL, BLUEBIRD_URL, RESORT_URL, RUNS_URL, SLUG, SNOWPACK_URL, load_fixture


def _entity_id(hass: HomeAssistant, platform: str, key: str) -> str:
    entity_id = er.async_get(hass).async_get_entity_id(platform, DOMAIN, f"{SLUG}_{key}")
    assert entity_id, key
    return entity_id


async def _setup(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def test_setup_creates_entities(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    await _setup(hass, mock_entry)
    assert mock_entry.state is ConfigEntryState.LOADED

    score = hass.states.get(_entity_id(hass, "sensor", "score"))
    assert score.state == "33"
    assert score.attributes["rating"] == "Solid"
    assert score.attributes[ATTR_ATTRIBUTION] == "Data by SnowSure.ai"

    depth = hass.states.get(_entity_id(hass, "sensor", "depth_summit"))
    assert depth.state == "78.0"
    assert depth.attributes["unit_of_measurement"] == "cm"

    forecast = hass.states.get(_entity_id(hass, "sensor", "forecast_7d"))
    assert len(forecast.attributes["daily"]) == 14

    lifts = hass.states.get(_entity_id(hass, "sensor", "lifts_open"))
    assert lifts.state == STATE_UNKNOWN
    assert lifts.attributes["total"] == 37

    assert hass.states.get(_entity_id(hass, "sensor", "avalanche_level")).state == "2"
    assert hass.states.get(_entity_id(hass, "binary_sensor", "open")).state == STATE_ON
    # Coordinates put the resort on the map dashboard.
    open_state = hass.states.get(_entity_id(hass, "binary_sensor", "open"))
    assert (open_state.attributes["latitude"], open_state.attributes["longitude"]) == (46.0207, 7.7491)
    assert hass.states.get(_entity_id(hass, "sensor", "season_opening")).state == "2026-11-01"

    (device,) = dr.async_entries_for_config_entry(dr.async_get(hass), mock_entry.entry_id)
    assert device.identifiers == {(DOMAIN, SLUG)}
    assert device.name == "Matterhorn Ski Paradise"
    assert device.manufacturer == "SnowSure"
    assert device.entry_type is dr.DeviceEntryType.SERVICE


async def test_disabled_by_default(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    await _setup(hass, mock_entry)
    registry = er.async_get(hass)
    disabled = {d.key for d in SENSORS if registry.async_get(_entity_id(hass, "sensor", d.key)).disabled_by is not None}
    assert disabled == {
        "depth_mid",
        "snowfall_48h",
        "snowfall_72h",
        "forecast_14d",
        "terrain_open",
        "temperature_mid",
    }


async def test_daily_forecast_is_not_recorded(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    await _setup(hass, mock_entry)
    entity = hass.data["entity_components"]["sensor"].get_entity(_entity_id(hass, "sensor", "forecast_7d"))
    assert "daily" in entity._unrecorded_attributes
    forecast = hass.states.get(_entity_id(hass, "sensor", "forecast_7d"))
    assert (forecast.attributes["change_24h"], forecast.attributes["change_48h"]) == (4.2, -5.1)


async def test_avalanche_failure_is_not_fatal(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    aioclient_mock.get(RESORT_URL, json=load_fixture("resort_detail.json"))
    aioclient_mock.get(AVALANCHE_URL, status=500)
    aioclient_mock.get(RUNS_URL, status=500)
    aioclient_mock.get(BLUEBIRD_URL, status=500)
    aioclient_mock.get(SNOWPACK_URL, status=500)
    await _setup(hass, mock_entry)
    assert mock_entry.state is ConfigEntryState.LOADED
    assert hass.states.get(_entity_id(hass, "sensor", "avalanche_level")).state == STATE_UNKNOWN
    assert hass.states.get(_entity_id(hass, "sensor", "score")).state == "33"
    assert hass.states.get(_entity_id(hass, "sensor", "forecast_7d")).attributes["change_24h"] is None


async def test_connection_error_retries_setup(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    aioclient_mock.get(RESORT_URL, status=502)
    mock_entry.add_to_hass(hass)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    assert mock_entry.state is ConfigEntryState.SETUP_RETRY


async def test_auth_error_starts_reauth(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    aioclient_mock.get(RESORT_URL, status=401)
    mock_entry.add_to_hass(hass)
    await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done()
    assert mock_entry.state is ConfigEntryState.SETUP_ERROR
    flows = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert [flow["context"]["source"] for flow in flows] == ["reauth"]


async def test_unload(hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry) -> None:
    await _setup(hass, mock_entry)
    assert await hass.config_entries.async_unload(mock_entry.entry_id)
    assert mock_entry.state is ConfigEntryState.NOT_LOADED


async def test_diagnostics_redact_the_key(hass: HomeAssistant, mock_api: AiohttpClientMocker) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Matterhorn Ski Paradise",
        unique_id=SLUG,
        data={"resort": SLUG, "resort_name": "Matterhorn Ski Paradise", CONF_API_KEY: "secret-test-key"},
    )
    await _setup(hass, entry)
    diagnostics = await async_get_config_entry_diagnostics(hass, entry)
    assert diagnostics["entry"]["data"][CONF_API_KEY] == "**REDACTED**"
    assert diagnostics["entry"]["has_api_key"] is True
    assert "secret-test-key" not in repr(diagnostics)
    assert diagnostics["coordinator"]["data"]["score"] == 33
    assert diagnostics["coordinator"]["data"]["forecast_daily"] == "<14 days>"


async def test_diagnostics_before_first_refresh(hass: HomeAssistant, mock_entry: MockConfigEntry) -> None:
    diagnostics = await async_get_config_entry_diagnostics(hass, mock_entry)
    assert diagnostics["coordinator"]["data"] is None


def test_scan_interval_is_clamped() -> None:
    assert async_scan_interval(SimpleNamespace(options={})) == timedelta(minutes=30)
    assert async_scan_interval(SimpleNamespace(options={CONF_SCAN_INTERVAL_MINUTES: 60})) == timedelta(minutes=60)
    assert async_scan_interval(SimpleNamespace(options={CONF_SCAN_INTERVAL_MINUTES: 1})) == timedelta(minutes=30)
    assert async_scan_interval(SimpleNamespace(options={CONF_SCAN_INTERVAL_MINUTES: "x"})) == timedelta(minutes=30)


async def test_image_entities(hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry) -> None:
    await _setup(hass, mock_entry)
    registry = er.async_get(hass)
    entries = [e for e in er.async_entries_for_config_entry(registry, mock_entry.entry_id) if e.domain == "image"]
    by_key = {e.unique_id.removeprefix(f"{SLUG}_"): e for e in entries}
    assert "resort_image" in by_key
    webcams = sorted(key for key in by_key if key.startswith("webcam_"))
    # Five usable webcams (the youtube stream is skipped); without a pick the
    # first three in SnowSure's order become entities, all enabled.
    assert webcams == [
        "webcam_gornergrat_3135m",
        "webcam_hohtalli_3273m",
        "webcam_matterhorn_glacier_paradise_3883m",
    ]
    assert all(by_key[key].disabled_by is None for key in webcams)

    first = hass.states.get(by_key["webcam_matterhorn_glacier_paradise_3883m"].entity_id)
    assert first.attributes["page_url"].startswith("https://zbag.roundshot.com/")
    assert first.attributes["friendly_name"] == "Matterhorn Ski Paradise Webcam Matterhorn Glacier Paradise (3883m)"


async def test_trail_map_entities(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    await _setup(hass, mock_entry)
    entity_id = _entity_id(hass, "image", "trail_map_winter_panoramic_map_zermatt_matterhorn_ski_paradise")
    state = hass.states.get(entity_id)
    assert state.attributes["pdf_url"].endswith(".pdf")
    assert state.attributes["position"] == 0
    assert state.attributes["friendly_name"].startswith("Matterhorn Ski Paradise Trail map Winter panoramic map")
    second = hass.states.get(_entity_id(hass, "image", "trail_map_breuil_cervinia_piste_map"))
    assert second.attributes["position"] == 1


async def test_webcam_refetches_after_each_refresh(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    await _setup(hass, mock_entry)
    entity_id = _entity_id(hass, "image", "webcam_matterhorn_glacier_paradise_3883m")
    entity = hass.data["entity_components"]["image"].get_entity(entity_id)
    entity._cached_image = object()
    before = entity.image_last_updated
    await mock_entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert entity._cached_image is None
    assert entity.image_last_updated >= before


async def test_forecast_confidence_sensor(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    await _setup(hass, mock_entry)
    state = hass.states.get(_entity_id(hass, "sensor", "forecast_confidence"))
    assert state.state == "low"
    assert state.attributes["options"] == ["low", "medium", "high"]
    assert state.attributes["week2"] == "medium"


async def test_powder_alarm_defaults_off(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    # Defaults: 15 cm at mid-mountain, today and tomorrow (0.5 and 0.3 cm).
    await _setup(hass, mock_entry)
    state = hass.states.get(_entity_id(hass, "binary_sensor", "powder_alarm"))
    assert state.state == "off"
    assert state.attributes["band"] == "mid"
    assert state.attributes["elevation"] == 2723
    assert state.attributes["date"] is None
    assert state.attributes["max_snowfall"] == 0.5


async def test_powder_alarm_follows_the_options(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        title=mock_entry.title,
        unique_id=mock_entry.unique_id,
        data=mock_entry.data,
        options={CONF_POWDER_THRESHOLD_CM: 10, CONF_POWDER_DAYS: 3, CONF_POWDER_BAND: "summit"},
    )
    await _setup(hass, entry)
    state = hass.states.get(_entity_id(hass, "binary_sensor", "powder_alarm"))
    assert state.state == STATE_ON
    assert state.attributes["date"] == "2026-11-06"
    assert state.attributes["snowfall"] == 11.7
    assert state.attributes["elevation"] == 3883


def test_powder_outlook_falls_back_to_the_forecast_point() -> None:
    daily = [{"date": "d1", "snowfall": 3}, {"date": "d2", "snowfall": 20, "snowfall_summit": None}]
    checked, first = powder_outlook(daily, 15, 2, "summit")
    assert [d["snowfall"] for d in checked] == [3, 20]
    assert first == {"date": "d2", "snowfall": 20}
    assert powder_outlook(None, 15, 2, "mid") == ([], None)


async def test_webcams_follow_the_options_pick(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    """Older versions left webcams 4+ disabled: a pick enables them, unpicked ones go."""
    mock_entry.add_to_hass(hass)
    registry = er.async_get(hass)
    old = registry.async_get_or_create(
        "image",
        DOMAIN,
        f"{SLUG}_webcam_rothorn_3104m",
        config_entry=mock_entry,
        disabled_by=er.RegistryEntryDisabler.INTEGRATION,
    )
    stale = registry.async_get_or_create("image", DOMAIN, f"{SLUG}_webcam_hohtalli_3273m", config_entry=mock_entry)
    hass.config_entries.async_update_entry(
        mock_entry, options={CONF_WEBCAMS: ["matterhorn_glacier_paradise_3883m", "rothorn_3104m"]}
    )
    await _setup(hass, mock_entry)

    webcams = sorted(
        e.unique_id.removeprefix(f"{SLUG}_")
        for e in er.async_entries_for_config_entry(registry, mock_entry.entry_id)
        if e.unique_id.startswith(f"{SLUG}_webcam_")
    )
    assert webcams == ["webcam_matterhorn_glacier_paradise_3883m", "webcam_rothorn_3104m"]
    assert registry.async_get(old.entity_id).disabled_by is None
    assert registry.async_get(stale.entity_id) is None


async def test_repicked_webcam_comes_back_enabled(
    hass: HomeAssistant, mock_api: AiohttpClientMocker, mock_entry: MockConfigEntry
) -> None:
    """Home Assistant restores a removed entity's disabled_by; a pick must override it."""
    mock_entry.add_to_hass(hass)
    registry = er.async_get(hass)
    old = registry.async_get_or_create(
        "image",
        DOMAIN,
        f"{SLUG}_webcam_rothorn_3104m",
        config_entry=mock_entry,
        suggested_object_id="matterhorn_rothorn",
        disabled_by=er.RegistryEntryDisabler.INTEGRATION,
    )
    registry.async_remove(old.entity_id)
    hass.config_entries.async_update_entry(mock_entry, options={CONF_WEBCAMS: ["rothorn_3104m"]})
    await _setup(hass, mock_entry)

    entity_id = registry.async_get_entity_id("image", DOMAIN, f"{SLUG}_webcam_rothorn_3104m")
    assert entity_id == old.entity_id
    assert registry.async_get(entity_id).disabled_by is None
    assert hass.states.get(entity_id) is not None
