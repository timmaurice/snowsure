"""Tests for the bundled card's static path and Lovelace resource."""

from __future__ import annotations

from pathlib import Path

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.snowsure import CARD_FILENAME, CARD_URL_PREFIX, _async_reconcile_card_resource, card_digest

NEW_URL = f"{CARD_URL_PREFIX}{CARD_FILENAME}?v=0.2.0"
OLD_URL = f"{CARD_URL_PREFIX}{CARD_FILENAME}?v=0.1.0"


class FakeResources:
    """Stand-in for ResourceStorageCollection, which loads lazily."""

    def __init__(self, stored: list[dict] | None = None) -> None:
        self._stored = [dict(item) for item in stored or []]
        self._items: list[dict] = []
        self.loaded = False

    async def async_load(self) -> None:
        self._items = [dict(item) for item in self._stored]
        self.loaded = True

    def async_items(self) -> list[dict]:
        return self._items

    async def async_create_item(self, data: dict) -> dict:
        item = {"id": f"new{len(self._items)}", **data}
        self._items.append(item)
        return item

    async def async_update_item(self, item_id: str, updates: dict) -> dict:
        item = next(item for item in self._items if item["id"] == item_id)
        item.update(updates)
        return item

    async def async_delete_item(self, item_id: str) -> None:
        self._items = [item for item in self._items if item["id"] != item_id]


async def test_registers_once_on_fresh_install() -> None:
    resources = FakeResources([{"id": "other", "url": "/local/other.js", "res_type": "module"}])
    await _async_reconcile_card_resource(resources, NEW_URL)
    await _async_reconcile_card_resource(resources, NEW_URL)
    urls = [item["url"] for item in resources.async_items()]
    assert urls == ["/local/other.js", NEW_URL]


async def test_updates_version_and_drops_duplicates() -> None:
    resources = FakeResources(
        [
            {"id": "a", "url": OLD_URL, "res_type": "module"},
            {"id": "b", "url": OLD_URL, "res_type": "module"},
        ]
    )
    await _async_reconcile_card_resource(resources, NEW_URL)
    assert [item["url"] for item in resources.async_items()] == [NEW_URL]


def test_built_card_ships_with_the_integration() -> None:
    card = Path(__file__).parent.parent / "custom_components" / "snowsure" / CARD_FILENAME
    assert card.is_file(), "run `npm run build` - the integration serves this file"


async def test_async_setup_serves_the_card(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "snowsure", {})
    await hass.async_block_till_done()


def test_card_digest_follows_the_content(tmp_path: Path) -> None:
    card = tmp_path / CARD_FILENAME
    card.write_text("one")
    first = card_digest(card)
    card.write_text("two")
    assert card_digest(card) != first
    assert len(first) == 8
    assert card_digest(tmp_path / "absent.js") == "missing"
