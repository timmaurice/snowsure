"""Shared fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.snowsure.const import API_URL, CONF_COUNTRY, CONF_RESORT, CONF_RESORT_NAME, DOMAIN

FIXTURES = Path(__file__).parent / "fixtures"
SLUG = "matterhorn-ski-paradise"
RESORT_URL = f"{API_URL}/resorts/{SLUG}"
AVALANCHE_URL = f"{RESORT_URL}/avalanche"
HISTORY_URL = f"{RESORT_URL}/snowfall-history"
RESORTS_URL = f"{API_URL}/resorts"


def load_fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant load custom_components/snowsure."""
    yield


@pytest.fixture
def mock_entry() -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title="Matterhorn Ski Paradise",
        unique_id=SLUG,
        data={CONF_RESORT: SLUG, CONF_RESORT_NAME: "Matterhorn Ski Paradise", CONF_COUNTRY: "Switzerland"},
    )


@pytest.fixture
def mock_api(aioclient_mock: AiohttpClientMocker) -> AiohttpClientMocker:
    """Answer the requests a refresh makes, plus the catalogue."""
    aioclient_mock.get(RESORT_URL, json=load_fixture("resort_detail.json"))
    aioclient_mock.get(AVALANCHE_URL, json=load_fixture("avalanche_bulletin.json"))
    aioclient_mock.get(HISTORY_URL, json=load_fixture("snowfall_history.json"))
    aioclient_mock.get(RESORTS_URL, json=load_fixture("resorts.json"))
    return aioclient_mock
