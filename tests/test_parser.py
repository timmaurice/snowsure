"""Tests for the payload reshaping."""

from __future__ import annotations

import copy

from custom_components.snowsure.parser import parse_avalanche, parse_resort, parse_trail_maps

from .conftest import load_fixture


def _detail() -> dict:
    return copy.deepcopy(load_fixture("resort_detail.json")["data"])


def test_parse_resort_core_values() -> None:
    data = parse_resort(_detail(), load_fixture("avalanche_bulletin.json"))
    assert data["name"] == "Matterhorn Ski Paradise"
    assert data["score"] == 33
    assert data["rating"] == "Solid"
    # The Conditions Resolver is the canonical depth source.
    assert (data["depth_base"], data["depth_mid"], data["depth_summit"]) == (31, 55, 78)
    assert data["snowfall_24h"] == 1.8
    assert data["snowfall_season"] == 70.1
    assert data["lifts_total"] == 37
    assert data["lifts_open"] is None
    assert data["is_open"] is True
    assert data["status"] == "OPEN"
    assert data["temperature_summit"] == -13.1
    assert data["snow_quality"] == "icy"
    assert data["avalanche_level"] == 2
    assert data["url"].endswith("/resorts/matterhorn-ski-paradise")


def test_daily_forecast_is_trimmed_to_known_fields() -> None:
    data = parse_resort(_detail())
    day = data["forecast_daily"][0]
    assert set(day) == {
        "date",
        "snowfall",
        "snowfall_low",
        "snowfall_high",
        "snowfall_base",
        "snowfall_mid",
        "snowfall_summit",
        "temp_min",
        "temp_max",
        "precipitation_probability",
        "weather_code",
        "conditions",
        "freezing_level",
        "precipitation",
        "wind_speed",
        "wind_bearing",
    }
    assert len(data["forecast_daily"]) == data["forecast_horizon_days"] == 14


def test_free_horizon_hides_the_14_day_total() -> None:
    detail = _detail()
    detail["forecast"]["forecastHorizonDays"] = 7
    data = parse_resort(detail)
    assert data["forecast_14d"] is None
    assert len(data["forecast_daily"]) == 7
    assert data["forecast_7d"] is not None


def test_depth_falls_back_without_conditions_envelope() -> None:
    detail = _detail()
    del detail["conditions"]
    data = parse_resort(detail)
    # modelDepth in the fixture says 31 / 78 / 78.
    assert (data["depth_base"], data["depth_mid"], data["depth_summit"]) == (31, 78, 78)
    assert data["status"] is None


def test_empty_detail_does_not_raise() -> None:
    data = parse_resort({"slug": "x"})
    assert data["name"] == "x"
    assert data["score"] is None
    assert data["forecast_daily"] == []
    assert data["avalanche_level"] is None


def test_bool_is_not_a_number() -> None:
    detail = _detail()
    detail["snow"]["last24hCm"] = True
    assert parse_resort(detail)["snowfall_24h"] is None


def test_no_bulletin_is_unknown_not_low() -> None:
    data = parse_avalanche(load_fixture("avalanche_none.json"))
    assert data["avalanche_level"] is None
    assert data["avalanche_coverage"] == "no_current_bulletin"
    assert data["avalanche_issuer"].startswith("SLF")
    assert parse_avalanche(None)["avalanche_level"] is None


def test_webcams_pick_a_live_image_where_there_is_one() -> None:
    cams = parse_resort(_detail())["webcams"]
    names = [cam["name"] for cam in cams]
    assert "Live stream" not in names  # youtube: a stream, not a picture
    iframe = cams[0]
    # An iframe player's URL is a page; its thumbnail is the picture.
    assert iframe["page_url"].startswith("https://zbag.roundshot.com/")
    assert iframe["image_url"] != iframe["page_url"]
    assert iframe["image_url"].startswith("https://backend.roundshot.com/")
    image_cam = next(cam for cam in cams if cam["name"] == "Wolf Creek style")
    # An "image" camera's URL is the live snapshot itself.
    assert image_cam["image_url"] == "https://player.example.com/snapshot/cam"


def test_webcams_skip_duplicates_and_insecure_urls() -> None:
    detail = _detail()
    detail["webcams"] = [
        {"name": "A", "type": "image", "url": "http://insecure.example/a.jpg"},
        {"name": "B", "type": "image", "url": "https://ok.example/b.jpg"},
        {"name": "B", "type": "image", "url": "https://ok.example/b2.jpg"},
        "garbage",
    ]
    assert [cam["name"] for cam in parse_resort(detail)["webcams"]] == ["B"]


def test_forecast_confidence() -> None:
    data = parse_resort(_detail())
    assert data["forecast_confidence"] == "low"
    assert data["forecast_confidence_week2"] == "medium"
    assert data["forecast_confidence_models"] == 6


def test_unknown_confidence_label_is_none() -> None:
    detail = _detail()
    detail["forecast"]["confidence"]["label"] = "unsure"
    assert parse_resort(detail)["forecast_confidence"] is None


def test_links_and_image_are_https_only() -> None:
    detail = _detail()
    data = parse_resort(detail)
    assert data["trail_map"].startswith("https://")
    assert (data["latitude"], data["longitude"]) == (46.0207, 7.7491)
    detail["heroImage"] = "http://cdn.example/x.jpg"
    assert parse_resort(detail)["image"] is None


def test_trail_maps_keep_hosted_https_previews() -> None:
    maps = parse_resort(_detail())["trail_maps"]
    # The external link and the plain-http preview are dropped.
    assert [m["label"] for m in maps] == [
        "Winter panoramic map (Zermatt - Matterhorn ski paradise)",
        "Breuil-Cervinia piste map",
    ]
    assert maps[0]["image_url"].endswith(".webp")
    assert maps[0]["pdf_url"].endswith(".pdf")
    assert (maps[0]["width"], maps[0]["height"]) == (2400, 1042)


def test_trail_maps_tolerate_garbage() -> None:
    assert parse_trail_maps(None) == []
    assert parse_trail_maps([None, {"type": "hosted"}, {"type": "hosted", "label": "x", "url": 3}]) == []


def test_forecast_days_carry_every_band() -> None:
    data = parse_resort(_detail())
    assert data["forecast_point_band"] == "mid"
    assert data["forecast_band_elevations"] == {"base": 1562, "mid": 2723, "summit": 3883}
    day = data["forecast_daily"][0]
    assert day["snowfall_mid"] == day["snowfall"]
    assert {"snowfall_base", "snowfall_summit"} <= day.keys()


def test_forecast_without_bands_keeps_the_point_forecast() -> None:
    detail = _detail()
    del detail["forecast"]["bands"]
    data = parse_resort(detail)
    assert data["forecast_band_elevations"] is None
    assert "snowfall_summit" not in data["forecast_daily"][0]


def test_forecast_change_from_the_runs() -> None:
    runs = load_fixture("forecast_runs.json")["data"]
    data = parse_resort(_detail(), forecast_runs=runs)
    assert (data["forecast_change_24h"], data["forecast_change_48h"]) == (4.2, -5.1)
    assert parse_resort(_detail())["forecast_change_24h"] is None
