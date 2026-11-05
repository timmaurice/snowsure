# SnowSure for Home Assistant

A Home Assistant integration for [SnowSure](https://www.snowsure.ai) ski resort data, with a bundled Lovelace card.

- Snow depth (valley, mid-mountain, summit), new snow (24 h – 7 days) and season snowfall
- 7-day snow forecast with a daily breakdown (14 days with SnowSure Pro)
- SnowSure score (0–100) with rating and tagline
- Lifts and runs open, resort open/closed, season dates
- Temperatures, weather, snow quality and the official avalanche danger level where a bulletin exists
- Forecast confidence (how far the weather models agree)
- Resort photo and webcams as image entities, served through Home Assistant

Data by [SnowSure.ai](https://www.snowsure.ai).

## Installation

HACS: add this repository as a custom repository (category _Integration_), install **SnowSure** and restart Home Assistant.

The card ships with the integration: it is served from the integration folder and registered as a Lovelace resource automatically (storage-mode dashboards). In YAML-mode dashboards add `/snowsure_frontend/snowsure-card.js` as a `module` resource yourself.

## Setup

_Settings → Devices & services → Add integration → SnowSure_

1. **API key (optional).** SnowSure's read API is public, so the field can stay empty. A key is sent as a bearer token and only matters for SnowSure Pro, which extends the forecast from 7 to 14 days.
2. **Country**, then **resort**. Each resort is its own entry and device.

Change the key later with _Reconfigure_; change the update interval (default 30 min) and the powder alarm with _Configure_.

## Entities

| Entity                                                         | Unit   | Enabled by default |
| -------------------------------------------------------------- | ------ | ------------------ |
| Open                                                           | on/off | yes                |
| Powder alarm                                                   | on/off | yes                |
| SnowSure score                                                 | 0–100  | yes                |
| Snow depth valley / summit                                     | cm     | yes                |
| Snow depth mid-mountain                                        | cm     | no                 |
| New snow 24h / 7 days, season snowfall                         | cm     | yes                |
| New snow 48h / 72h                                             | cm     | no                 |
| Snow forecast 7 days (attribute `daily`)                       | cm     | yes                |
| Snow forecast 14 days (Pro only)                               | cm     | no                 |
| Lifts open / runs open (attribute `total`)                     | –      | yes                |
| Terrain open                                                   | %      | no                 |
| Temperature valley / summit                                    | °C     | yes                |
| Temperature mid-mountain                                       | °C     | no                 |
| Weather, snow quality                                          | text   | yes                |
| Avalanche danger level (1–5)                                   | –      | yes                |
| Forecast confidence (low / medium / high)                      | –      | yes                |
| Resort image                                                   | image  | yes                |
| Webcam _name_ (picked in the options; default the first three) | image  | yes                |
| Trail map _name_                                               | image  | yes                |
| Season opening / closing, last updated                         | date   | yes (diagnostic)   |

### Webcams

Resorts list up to a dozen webcams. The integration options (Settings → Devices & services → SnowSure → Configure) list them all; tick the ones you want (more than three asks for a confirmation, since each one downloads its picture on every refresh). Only the ticked ones become entities, all enabled; the card shows them all.

### Powder alarm

On while a day in the look-ahead window forecasts at least the threshold of new snow at the chosen height. Defaults: 15 cm, today and tomorrow, mid-mountain; set all three under _Configure_. The attributes name the first such day (`date`, `snowfall`) and the biggest day in the window (`max_snowfall`), so a notification needs no template:

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.matterhorn_ski_paradise_powder_alarm
    to: 'on'
actions:
  - action: notify.mobile_app_phone
    data:
      message: >-
        Powder: {{ state_attr(trigger.entity_id, 'snowfall') }} cm
        on {{ state_attr(trigger.entity_id, 'date') }}
```

`unknown` means SnowSure has no value — for example no lift report, or no current avalanche bulletin. A missing bulletin is never a low danger rating.

## Card

```yaml
type: custom:snowsure-card
device: <device id of the resort> # picked in the visual editor
title: Zermatt # optional
show_score: true
show_image: true # resort photo as header background
show_weather: true
show_mountain: true # mountain with snow depth, temperature, 0 °C line and the avalanche diamond
show_stats: true
stats: # tiles, in this order
  - depth_base
  - depth_summit
  - snowfall_24h
  - snowfall_7d
  - snowfall_season
  - snow_quality
  - runs_open
  - lifts_open
show_forecast: true
forecast_days: 7 # 1–14
forecast_band: mid # base, mid or summit; unset = SnowSure's forecast point
show_avalanche: true
show_webcams: true # the webcams picked in the integration options
```

Available tiles: `depth_base`, `depth_mid`, `depth_summit`, `snowfall_24h`, `snowfall_7d`, `snowfall_season`, `forecast_7d`, `runs_open`, `lifts_open`, `temperature_base`, `temperature_summit`, `snow_quality`.

SnowSure's daily forecast is for one point, usually mid-mountain. A switch under the bars shows the snowfall at valley, mid or summit (each with its height); `forecast_band` picks where it starts. SnowSure has one temperature series only, so the temperature lines do not change with it.

Weather, snow quality and avalanche levels are translated by the card; SnowSure delivers them in English. Webcams and the resort photo load through Home Assistant's image proxy, so the browser makes no third-party requests.

The trail map (a PDF from SnowSure) opens in a dialog over the dashboard; ctrl/cmd-click opens it in a new tab instead. Android's WebView, and so the Android companion app, cannot show PDFs inline — use the new-tab button in the dialog there.

The card follows its own width. In a normal section column it stacks everything and shrinks the tiles; from 640 px (a section spanning two columns, or a panel view) it switches to two columns: weather, tiles and avalanche on the left, the forecast on the right, webcams below.

Everything can be set in the visual editor. The card is also offered in the card picker for SnowSure entities.

## Development

```bash
npm ci
npm run build          # -> custom_components/snowsure/snowsure-card.js
npm run lint && npm run check-format && npm test

pip install .[dev]
PYTHONPATH=. pytest
ruff check . && ruff format --check .

docker compose up -d   # Home Assistant on http://localhost:8138
```

The card in `frontend/` is built into `custom_components/snowsure/snowsure-card.js`, which is committed: the integration serves it and registers it as a Lovelace resource.

## Credits

Data by [SnowSure.ai](https://www.snowsure.ai). Avalanche danger icons by the [European Avalanche Warning Services (EAWS)](https://www.avalanches.org/downloads/), with colour and number in the lower half as on [lawinen.report](https://lawinen.report/education/danger-scale).
