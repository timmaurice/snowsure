"""Constants for the SnowSure integration."""

from __future__ import annotations

DOMAIN = "snowsure"

BASE_URL = "https://www.snowsure.ai"
API_URL = f"{BASE_URL}/api/v1"
USER_AGENT = "HomeAssistant snowsure integration"

ATTRIBUTION = "Data by SnowSure.ai"

CONF_COUNTRY = "country"
CONF_RESORT = "resort"
CONF_RESORT_NAME = "resort_name"
CONF_SCAN_INTERVAL_MINUTES = "scan_interval_minutes"

# SnowSure ingests forecasts hourly and resort reports a few times a day, so a
# half-hour poll is fresh enough. The public budget is 120 requests per minute
# per IP and endpoint; one refresh costs two requests, so even the lower bound
# stays far away from it.
DEFAULT_SCAN_INTERVAL_MINUTES = 30
MIN_SCAN_INTERVAL_MINUTES = 15
MAX_SCAN_INTERVAL_MINUTES = 360

# Powder alarm: on when a day in the next POWDER_DAYS forecasts at least the
# threshold at the chosen height. Today and tomorrow, 15 cm, mid-mountain (the
# height SnowSure's own headline forecast uses).
CONF_POWDER_THRESHOLD_CM = "powder_threshold_cm"
CONF_POWDER_DAYS = "powder_days"
CONF_POWDER_BAND = "powder_band"
DEFAULT_POWDER_THRESHOLD_CM = 15
DEFAULT_POWDER_DAYS = 2
DEFAULT_POWDER_BAND = "mid"
POWDER_BANDS = ("base", "mid", "summit")
MAX_POWDER_DAYS = 7

# Webcams: the entry creates entities for the ones picked in the options (by
# webcam key, see webcam_key), at most MAX_WEBCAMS; without a pick the first
# ones in SnowSure's order. Resorts list up to a dozen.
CONF_WEBCAMS = "webcams"
MAX_WEBCAMS = 3
