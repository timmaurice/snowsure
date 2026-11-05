"""Reshape SnowSure payloads into the flat dict the entities and the card read.

The resort detail endpoint is large (~40 kB) and nests the same number in
several places. This module picks one canonical source per value, with
documented fallbacks, so entities never have to know the upstream layout.

The returned dict is the contract between ``sensor.py``/``binary_sensor.py``
and the Lovelace card (through state attributes): renaming a key means
changing both sides.
"""

from __future__ import annotations

from typing import Any

from homeassistant.util import slugify

from .const import BASE_URL, RECOMMENDED_WEBCAMS

# The daily forecast is exposed as an attribute, so only what the card and
# templates need survives - one day of the raw payload has ~20 fields.
_DAILY_FIELDS = {
    "date": "date",
    "snowfall": "snowfall",
    "snowfallLoCm": "snowfall_low",
    "snowfallHiCm": "snowfall_high",
    "tempMin": "temp_min",
    "tempMax": "temp_max",
    "precipProb": "precipitation_probability",
    "code": "weather_code",
    "conditions": "conditions",
    "flMax": "freezing_level",
    "precip": "precipitation",
    "wind": "wind_speed",
    "windDirection": "wind_bearing",
}


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _num(value: Any) -> float | None:
    """Return ``value`` as a float, or None for anything not numeric.

    bool is an int subclass and must not turn into 1.0.
    """
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def _int(value: Any) -> int | None:
    number = _num(value)
    return int(round(number)) if number is not None else None


def _str(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _resolved(envelope: Any) -> Any:
    """Unwrap a Conditions Resolver field ``{value, source, observedAt, confidence}``."""
    return _dict(envelope).get("value")


def _https(value: Any) -> str | None:
    """A URL that is safe to hand to an image fetch or a link: https only."""
    return value if isinstance(value, str) and value.startswith("https://") else None


def _first(*values: Any) -> float | None:
    """The first value that is numeric."""
    for value in values:
        number = _num(value)
        if number is not None:
            return number
    return None


def parse_resort(
    detail: dict[str, Any],
    avalanche: dict[str, Any] | None = None,
    *,
    forecast_runs: dict[str, Any] | None = None,
    bluebird: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build the coordinator payload from the detail and the optional extra responses."""
    conditions = _dict(_dict(detail.get("conditions")).get("data"))
    snow = _dict(detail.get("snow"))
    model_depth = _dict(snow.get("modelDepth"))
    by_elevation = _dict(detail.get("conditionsByElevation"))
    operations = _dict(detail.get("operations"))
    score = _dict(detail.get("snowSure"))
    current = _dict(detail.get("currentConditions"))
    forecast = _dict(detail.get("forecast"))
    links = _dict(detail.get("links"))
    elevation = _dict(detail.get("elevation"))
    closure = _dict(detail.get("closure"))

    depth = _dict(conditions.get("depth"))

    def depth_at(band: str) -> float | None:
        # The resolver's value is canonical (station > report > model); the
        # model depth and the per-elevation block are fallbacks for payloads
        # that come without the conditions envelope.
        return _first(
            _resolved(depth.get(band)),
            _dict(model_depth.get(band)).get("cm"),
            _dict(_dict(by_elevation.get(band)).get("snowDepth")).get("cm"),
        )

    def temperature_at(band: str) -> float | None:
        return _num(_dict(_dict(by_elevation.get(band)).get("temperature")).get("celsius"))

    lifts = _dict(_resolved(conditions.get("lifts")))
    runs = _dict(_resolved(conditions.get("runs")))
    snow_quality = _dict(_resolved(conditions.get("snowQuality")))

    horizon = _int(forecast.get("forecastHorizonDays")) or 7
    daily = [
        {target: day.get(source) for source, target in _DAILY_FIELDS.items()}
        for day in forecast.get("daily", [])
        if isinstance(day, dict)
    ][:horizon]
    band_elevations = _add_band_snowfall(daily, _dict(_dict(forecast.get("bands")).get("bands")))
    peak = _dict(forecast.get("peak"))

    forecast_7d = _first(forecast.get("total7dCm"), _resolved(_dict(conditions.get("forecast")).get("next7dCm")))
    # With the free seven-day horizon SnowSure keeps the field name but fills
    # it with the 7-day total. Report nothing rather than a duplicate.
    forecast_14d = _num(forecast.get("total14dCm")) if horizon > 7 else None

    slug = _str(detail.get("slug")) or ""

    return {
        "slug": slug,
        "name": _str(detail.get("name")) or slug,
        "country": _str(detail.get("country")),
        "region": _str(detail.get("region")),
        "url": _str(links.get("snowsure")) or f"{BASE_URL}/resorts/{slug}",
        "website": _str(links.get("website")),
        "latitude": _num(_dict(detail.get("coordinates")).get("lat")),
        "longitude": _num(_dict(detail.get("coordinates")).get("lng")),
        "image": _https(detail.get("heroImage")),
        "elevation_base": _int(elevation.get("base")),
        "elevation_summit": _int(elevation.get("summit")),
        # Status
        "is_open": detail.get("isOpen") if isinstance(detail.get("isOpen"), bool) else None,
        "operating_today": detail.get("operatingToday") if isinstance(detail.get("operatingToday"), bool) else None,
        "status": _str(_resolved(conditions.get("status"))),
        "closure_reason": _str(closure.get("reason")),
        "closure_label": _str(closure.get("label")),
        "season_opening": _str(_resolved(conditions.get("seasonOpening"))) or _str(detail.get("seasonOpeningDate")),
        "season_closing": _str(_resolved(conditions.get("seasonClosing"))) or _str(detail.get("seasonClosingDate")),
        # SnowSure score
        "score": _int(score.get("score")),
        "rating": _str(score.get("rating")),
        "rating_color": _str(score.get("ratingColor")),
        "tagline": _str(score.get("tagline")),
        "trend": _str(score.get("trend")),
        "score_breakdown": _dict(score.get("breakdown")) or None,
        # Snow depth
        "depth_base": depth_at("base"),
        "depth_mid": depth_at("mid"),
        "depth_summit": depth_at("summit"),
        "depth_vs_average_pct": _first(_resolved(conditions.get("depthVsAvgPct")), snow.get("depthVsAvgPct")),
        "depth_source": _str(snow.get("depthSourceLabel")),
        # Snowfall
        "snowfall_24h": _num(snow.get("last24hCm")),
        "snowfall_48h": _num(snow.get("last48hCm")),
        "snowfall_72h": _num(snow.get("last72hCm")),
        "snowfall_7d": _num(snow.get("last7dCm")),
        "snowfall_season": _num(snow.get("seasonTotalCm")),
        # Forecast
        "forecast_7d": forecast_7d,
        "forecast_14d": forecast_14d,
        "forecast_horizon_days": horizon,
        "forecast_peak_date": _str(peak.get("date")),
        # Signed change of the 7-day total against the run 24 h / 48 h earlier.
        "forecast_change_24h": _num(_dict(_dict(forecast_runs).get("delta24h")).get("total7dCm")),
        "forecast_change_48h": _num(_dict(_dict(forecast_runs).get("delta48h")).get("total7dCm")),
        "bluebird_predictions": parse_bluebird(bluebird, _str(detail.get("slug"))),
        "forecast_peak_snowfall": _num(peak.get("snowfallCm")),
        "forecast_daily": daily,
        # The daily snowfall above is for this band; snowfall_<band> per day has all three.
        "forecast_point_band": _str(_dict(forecast.get("forecastPoint")).get("band"))
        or _str(forecast.get("pointBand")),
        "forecast_band_elevations": band_elevations or None,
        # Operations
        "lifts_open": _int(_first(lifts.get("open"), operations.get("liftsOpen"))),
        "lifts_total": _int(_first(lifts.get("total"), operations.get("liftsTotal"))),
        "runs_open": _int(_first(runs.get("open"), operations.get("runsOpen"))),
        "runs_total": _int(_first(runs.get("total"), operations.get("runsTotal"))),
        "terrain_open_pct": _num(operations.get("terrainPercentOpen")),
        # Weather
        "weather": _str(current.get("conditions")),
        "current_temperature": _num(current.get("temperature")),
        "current_wind_speed": _num(current.get("windSpeed")),
        "current_humidity": _num(current.get("humidity")),
        "temperature_base": temperature_at("base"),
        "temperature_mid": temperature_at("mid"),
        "temperature_summit": temperature_at("summit"),
        "snow_quality": _str(snow_quality.get("label")),
        "snow_quality_description": _str(snow_quality.get("description")),
        "updated_at": _str(_dict(detail.get("liveData")).get("asOf")) or _str(current.get("lastUpdated")),
        # Forecast confidence (week 1, and week 2 where the horizon reaches it)
        **parse_confidence(forecast),
        # Media
        "trail_map": _https(links.get("trailMapPdf")) or _https(links.get("trailMap")),
        "trail_maps": parse_trail_maps(links.get("trailMaps")),
        "webcams": parse_webcams(detail.get("webcams")),
        # Avalanche
        **parse_avalanche(avalanche),
    }


FORECAST_BANDS = ("base", "mid", "summit")


def _add_band_snowfall(daily: list[dict[str, Any]], bands: dict[str, Any]) -> dict[str, int]:
    """Add ``snowfall_base/mid/summit`` to each forecast day; return each band's elevation.

    SnowSure's daily forecast is for one point (usually mid-mountain); the bands
    block has the snowfall at valley, mid and summit height for the same days.
    """
    elevations: dict[str, int] = {}
    for band in FORECAST_BANDS:
        block = _dict(bands.get(band))
        by_date = {
            day.get("date"): _num(day.get("snowCm")) for day in block.get("daily") or [] if isinstance(day, dict)
        }
        if not by_date:
            continue
        if (elevation := _int(block.get("elevationM"))) is not None:
            elevations[band] = elevation
        for day in daily:
            day[f"snowfall_{band}"] = by_date.get(day.get("date"))
    return elevations


def parse_avalanche(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Flatten the avalanche envelope.

    ``data`` is null whenever the warning service publishes no bulletin for the
    resort (off season, outside every zone, country not covered). That is *not*
    a low danger rating, so the level stays None and ``coverage`` says why.
    """
    meta = _dict(_dict(payload).get("meta"))
    data = _dict(_dict(payload).get("data"))
    return {
        "avalanche_level": _int(data.get("dangerRating")),
        "avalanche_label": _str(data.get("dangerLabel")),
        "avalanche_advice": _str(data.get("travelAdvice")),
        "avalanche_valid_until": _str(data.get("validUntil")),
        "avalanche_issuer": _str(data.get("issuer")) or _str(meta.get("issuer")),
        "avalanche_link": _str(data.get("link")) or _str(meta.get("link")),
        "avalanche_coverage": _str(meta.get("coverage")),
    }


# Webcam types whose ``url`` is itself a live JPEG. For the others (iframe
# players, Feratel pages) ``url`` is an HTML page and only ``thumbnailUrl`` is
# an image: a live one for Feratel, a copy SnowSure refreshes for the rest.
_LIVE_IMAGE_TYPES = frozenset({"image", "panomax", "skaping"})
# YouTube "webcams" are streams; their thumbnail is a video poster, often 404.
_SKIPPED_WEBCAM_TYPES = frozenset({"youtube"})


def parse_webcams(raw: Any) -> list[dict[str, str | None]]:
    """The resort's webcams that have an image, in SnowSure's order."""
    cams: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for cam in raw if isinstance(raw, list) else []:
        if not isinstance(cam, dict) or cam.get("type") in _SKIPPED_WEBCAM_TYPES:
            continue
        name = _str(cam.get("name"))
        page = _https(cam.get("url")) or _https(cam.get("embedUrl"))
        image = page if cam.get("type") in _LIVE_IMAGE_TYPES else None
        image = image or _https(cam.get("thumbnailUrl"))
        if not name or not image or name in seen:
            continue
        seen.add(name)
        cams.append({"name": name, "image_url": image, "page_url": page, "credit": _str(cam.get("credit"))})
    return cams


def parse_trail_maps(raw: Any) -> list[dict[str, Any]]:
    """Trail maps SnowSure hosts, each with a rendered preview image.

    The preview (WebP, 2400 px on the long side) is what the card shows: every
    browser displays it, while embedded PDFs fail in Android's WebView and in
    browsers set to download PDFs. ``pdf`` is the original for the full detail.
    """
    maps: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or item.get("type") != "hosted":
            continue
        label = _str(item.get("label"))
        image = _https(item.get("url"))
        if not label or not image or label in seen:
            continue
        seen.add(label)
        maps.append(
            {
                "label": label,
                "image_url": image,
                "pdf_url": _https(item.get("downloadUrl")),
                "width": _int(item.get("width")),
                "height": _int(item.get("height")),
            }
        )
    return maps


def parse_confidence(forecast: dict[str, Any]) -> dict[str, Any]:
    """SnowSure's verdict on how far the weather models agree (low/medium/high)."""
    week1 = _dict(forecast.get("confidence"))
    week2 = _dict(forecast.get("confidenceWeek2"))
    label = _str(week1.get("label"))
    return {
        "forecast_confidence": label if label in ("low", "medium", "high") else None,
        "forecast_confidence_score": _num(week1.get("score")),
        "forecast_confidence_spread": _num(week1.get("spreadCm")),
        "forecast_confidence_models": _int(week1.get("modelCount")),
        "forecast_confidence_week2": _str(week2.get("label")),
    }


def webcam_key(name: str) -> str:
    """Stable handle of a webcam: its name, slugified (also the unique_id suffix)."""
    return slugify(name)


def picked_webcams(option: Any, cams: list[dict[str, Any]]) -> set[str]:
    """The webcam keys to create: the option's, else the first RECOMMENDED_WEBCAMS."""
    if isinstance(option, list):
        return {key for key in option if isinstance(key, str)}
    return {webcam_key(cam["name"]) for cam in cams[:RECOMMENDED_WEBCAMS]}


def parse_bluebird(rows: list[dict[str, Any]] | None, slug: str | None) -> list[dict[str, Any]]:
    """SnowSure's bluebird predictions for this resort, by date."""
    if not slug:
        return []
    found = [
        {
            "date": _str(row.get("predictedDate")),
            "confidence": _str(row.get("confidence")),
            "snowfall": _num(row.get("predictedSnowfallCm")),
            "temp_max": _num(row.get("predictedTempMaxC")),
            "wind_max": _num(row.get("predictedWindMaxKmh")),
        }
        for row in rows or []
        if row.get("resortSlug") == slug and _str(row.get("predictedDate"))
    ]
    return sorted(found, key=lambda row: row["date"])


# A bluebird day: clear (WMO 0 or 1), dry, after new snow the day before or
# that night. The same rule SnowSure describes; its own list is short.
BLUEBIRD_CODES = (0, 1)
BLUEBIRD_MAX_PRECIP_PROB = 20
BLUEBIRD_MIN_FRESH_CM = 5


def bluebird_days(
    daily: list[dict[str, Any]] | None,
    band: str,
    predictions: list[dict[str, Any]] | None = None,
    min_fresh: float = BLUEBIRD_MIN_FRESH_CM,
) -> list[dict[str, Any]]:
    """Clear, dry days after fresh snow in the forecast, plus SnowSure's own predictions."""
    days = daily or []
    found: dict[str, dict[str, Any]] = {}

    def fresh(day: dict[str, Any]) -> float:
        amount = day.get(f"snowfall_{band}")
        return float(amount if amount is not None else day.get("snowfall") or 0)

    for index in range(1, len(days)):
        day, before = days[index], days[index - 1]
        clear = day.get("weather_code") in BLUEBIRD_CODES
        dry = (day.get("precipitation_probability") or 0) <= BLUEBIRD_MAX_PRECIP_PROB
        if clear and dry and fresh(before) >= min_fresh and day.get("date"):
            found[day["date"]] = {"date": day["date"], "fresh_snow": round(fresh(before), 1), "source": "forecast"}
    for prediction in predictions or []:
        date = prediction["date"]
        found.setdefault(date, {"date": date, "fresh_snow": prediction.get("snowfall"), "source": "snowsure"})
        found[date]["confidence"] = prediction.get("confidence")
    return sorted(found.values(), key=lambda row: row["date"])
