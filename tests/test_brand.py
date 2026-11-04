"""The brand images Home Assistant and HACS read from custom_components/snowsure/brand."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

BRAND = Path(__file__).parent.parent / "custom_components" / "snowsure" / "brand"


@pytest.mark.parametrize(("name", "size"), [("icon.png", 256), ("icon@2x.png", 512)])
def test_icons_are_square(name: str, size: int) -> None:
    with Image.open(BRAND / name) as image:
        assert image.size == (size, size)


@pytest.mark.parametrize("stem", ["logo", "dark_logo"])
def test_logos_are_landscape_within_limits(stem: str) -> None:
    for suffix, low, high in (("", 128, 256), ("@2x", 256, 512)):
        with Image.open(BRAND / f"{stem}{suffix}.png") as image:
            width, height = image.size
            assert width >= height
            assert low <= min(width, height) <= high
            assert image.mode == "RGBA"
