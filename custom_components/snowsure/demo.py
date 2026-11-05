"""A made-up resort for development: every case the card can show, every day.

Only active with the environment variable ``SNOWSURE_DEMO=1`` (the local test
container sets it). Then the resort list gains "Kaiserberg (Demo)" and the
client answers its requests from here instead of SnowSure. The dates follow
today, so the cases never run out:

- open, score 72, 85 cm at the summit, 25 cm new snow today (powder alarm)
- tomorrow and in four days a clear, dry day after new snow (Kaiserwetter)
- avalanche danger 4 (high), valid until tomorrow
- forecast up 12.4 cm since yesterday, snow quality from the snowpack model
- 0 °C line between valley and summit, all three heights with snowfall
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any

DEMO_SLUG = "kaiserberg-demo"
DEMO_NAME = "Kaiserberg (Demo)"
DEMO_COUNTRY = "Demo"
DEMO_REGION = "Europe"

# Valley, mid, summit (m).
_ELEVATIONS = {"base": 1450, "mid": 2300, "summit": 3150}

# Per day: WMO code, precipitation probability, snowfall at valley / mid / summit (cm), min / max °C.
_DAYS = [
    (75, 95, 12.0, 25.0, 31.0, -9.0, -3.0),  # today: heavy snowfall
    (0, 0, 0.0, 0.0, 0.0, -14.0, -5.0),  # tomorrow: Kaiserwetter
    (2, 10, 0.0, 0.0, 0.2, -12.0, -4.0),
    (73, 80, 3.0, 9.0, 14.0, -10.0, -4.0),
    (1, 5, 0.0, 0.0, 0.0, -13.0, -6.0),  # Kaiserwetter after 9 cm
    (3, 30, 0.0, 0.4, 1.0, -8.0, -2.0),
    (61, 70, 0.0, 1.5, 4.0, -3.0, 2.0),
]

_CONDITIONS = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    61: "Slight rain",
    73: "Moderate snowfall",
    75: "Heavy snowfall",
}


def demo_enabled() -> bool:
    return os.environ.get("SNOWSURE_DEMO") == "1"


def demo_detail(today: date | None = None) -> dict[str, Any]:
    """The resort detail, shaped like SnowSure's ``data`` object."""
    today = today or date.today()
    dates = [(today + timedelta(days=i)).isoformat() for i in range(len(_DAYS))]
    daily = [
        {
            "date": day,
            "code": code,
            "conditions": _CONDITIONS[code],
            "precipProb": prob,
            "snowfall": mid,
            "tempMin": low,
            "tempMax": high,
            "flMax": 1900 if high > 0 else 1700,
            "precip": round(mid * 0.8, 1),
            "wind": 12.0,
            "windDirection": 300,
        }
        for day, (code, prob, _base, mid, _summit, low, high) in zip(dates, _DAYS, strict=True)
    ]
    bands = {
        band: {
            "elevationM": _ELEVATIONS[band],
            "daily": [{"date": day, "snowCm": values[index]} for day, values in zip(dates, _DAYS, strict=True)],
        }
        for index, band in ((2, "base"), (3, "mid"), (4, "summit"))
    }

    def resolved(value: Any) -> dict[str, Any]:
        return {"value": value, "source": "demo"}

    return {
        "name": DEMO_NAME,
        "slug": DEMO_SLUG,
        "country": DEMO_COUNTRY,
        "region": DEMO_REGION,
        "isOpen": True,
        "operatingToday": True,
        "coordinates": {"lat": 47.25, "lng": 11.4},
        "elevation": {"base": _ELEVATIONS["base"], "summit": _ELEVATIONS["summit"], "unit": "m"},
        "seasonOpeningDate": (today - timedelta(days=20)).isoformat(),
        "seasonClosingDate": (today + timedelta(days=150)).isoformat(),
        "snowSure": {
            "score": 72,
            "rating": "Excellent",
            "ratingColor": "#22c55e",
            "tagline": "Demo resort: every case at once.",
            "trend": "improving",
        },
        "currentConditions": {"temperature": -6.5, "conditions": "Heavy snowfall", "windSpeed": 18, "humidity": 96},
        "conditionsByElevation": {
            "base": {"temperature": {"celsius": 1.5}},
            "mid": {"temperature": {"celsius": -4.0}},
            "summit": {"temperature": {"celsius": -11.0}},
        },
        "snow": {"last24hCm": 25.0, "last7dCm": 38.0, "seasonTotalCm": 142.0, "depthSourceLabel": "Demo"},
        "operations": {"liftsTotal": 24, "runsTotal": 60},
        "conditions": {
            "data": {
                "status": resolved("OPEN"),
                "depth": {"base": resolved(40), "mid": resolved(62), "summit": resolved(85)},
                "depthVsAvgPct": resolved(128),
                "lifts": resolved({"open": 21, "total": 24}),
                "runs": resolved({"open": 52, "total": 60}),
                "snowQuality": resolved({"label": "powder", "description": "Fresh powder"}),
            }
        },
        "forecast": {
            "forecastHorizonDays": len(_DAYS),
            "total7dCm": sum(day[3] for day in _DAYS),
            "forecastPoint": {"band": "mid", "elevationM": _ELEVATIONS["mid"]},
            "peak": {"date": dates[0], "snowfallCm": _DAYS[0][3]},
            "daily": daily,
            "bands": {"bands": bands},
            "confidence": {"label": "high", "score": 0.9, "modelCount": 9},
        },
        "links": {"website": "https://www.snowsure.ai"},
        "liveData": {"asOf": f"{today.isoformat()}T07:00:00+00:00"},
        "webcams": [],
    }


def demo_avalanche(today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    return {
        "meta": {"coverage": "bulletin", "issuer": "Demo warning service"},
        "data": {
            "dangerRating": 4,
            "dangerLabel": "High",
            "travelAdvice": "Demo bulletin.",
            "validUntil": f"{(today + timedelta(days=1)).isoformat()}T17:00:00",
            "issuer": "Demo warning service",
            "link": "https://www.avalanches.org/",
        },
    }


def demo_forecast_runs() -> dict[str, Any]:
    return {"delta24h": {"total7dCm": 12.4}, "delta48h": {"total7dCm": 20.1}}


def demo_snowpack() -> dict[str, Any]:
    return {
        "locked": False,
        "snowQuality": {
            "label": "dry_powder",
            "reason": "Fresh, cold snow (demo)",
            "band": "mid",
            "aspect": "flat",
            "confidence": "high",
        },
    }
