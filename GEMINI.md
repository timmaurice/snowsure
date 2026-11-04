# GEMINI.md

AI context for maintaining this repository.

## What this repo is

One HACS integration (`custom_components/snowsure`) that bundles its own Lovelace card. The TypeScript card in `frontend/` is built by rollup into `custom_components/snowsure/snowsure-card.js`; that file is committed, because the integration serves it as a static path (`/snowsure_frontend/…`) and registers it as a Lovelace resource in `async_setup`.

## Upstream

SnowSure public API, `https://www.snowsure.ai/api/v1` (OpenAPI: `https://www.snowsure.ai/openapi.json`). Reads need no authentication; budget 120 requests/min per IP and endpoint. An optional key is sent as `Authorization: Bearer …` and only unlocks Pro entitlements (14-day forecast). Every display of the data must credit "Data by SnowSure.ai" with a link — entities carry `attribution`, the card renders the footer link.

One refresh = two requests: `GET /resorts/{slug}` (detail, includes the conditions envelope and `forecast.bands` with valley/mid/summit snowfall) and `GET /resorts/{slug}/avalanche` (optional, failure is not fatal). Every three hours a third one, `GET /resorts/{slug}/snowfall-history?pastSeasons=0` (~60 KB, optional), feeds the past days of the card's chart through the `daily` attribute of the 7-day new snow sensor. The config flow reads `GET /resorts?limit=1000&sort=name` once (~1 MB).

## Layout

- `api.py` – HTTP client, error mapping (401/403 auth, 404, 429 with Retry-After), slug validation
- `parser.py` – reshapes the payload into the flat dict that entities and the card read. **Contract with `sensor.py` and the card's attributes.**
- `coordinator.py` – `SnowsureCoordinator`, `entry.runtime_data`; auth errors -> reauth
- `config_flow.py` – user (optional key) -> country -> resort; reauth and reconfigure for the key; `OptionsFlowWithReload` for the interval. No update listener (conflicts with `async_update_reload_and_abort`).
- `sensor.py` / `binary_sensor.py` / `entity.py` – one service device per resort, `translation_key` for every entity, unique_id `<slug>_<key>`
- `binary_sensor.py` – open, and the powder alarm (threshold, days ahead and height are options)
- `image.py` – resort photo, webcams (first three enabled) and trail maps (SnowSure's WebP previews of the PDFs, shown in the card's dialog). `ImageEntity` never drops its cached download on its own, so webcams clear `_cached_image` on every refresh. Webcam types `image`/`panomax`/`skaping` have a live JPEG in `url`; the others only a `thumbnailUrl`; YouTube is skipped
- `frontend/src` – card (`snowsure-card.ts`), editor (`editor.ts`, `ha-form`), entity lookup by `translation_key` (`entities.ts`), locale-aware formatting (`format.ts`), weather/snow-quality translation by text (`weather.ts`; SnowSure's WMO code often contradicts its own text, the text is authoritative)

## Commands

```bash
npm ci
npm run build          # -> custom_components/snowsure/snowsure-card.js
npm run lint && npm run check-format && npm test

pip install .[dev]
PYTHONPATH=. pytest
ruff check . && ruff format --check .
```

## Local Home Assistant

```bash
docker compose up -d   # http://localhost:8138, admin / password
```

`docker-compose.override.yml` (gitignored) mounts the Zscaler CA bundle. The Lovelace resource URL carries the version plus a SHA-256 prefix of the bundle, so a rebuild reaches the browser after an HA restart without a hard reload.

## Brand images

`custom_components/snowsure/brand/` is built from SnowSure's own public assets (`/icon-512.png`, `/images/snowsure-logo.png`, `/images/snowsure-logo_white.png` on snowsure.ai), trimmed and resized; `tests/test_brand.py` checks the sizes. The SnowSure logo is a trademark of Afore and the terms do not grant logo use explicitly - get SnowSure's permission (info@snowsure.ai) before publishing the repo or submitting it to HACS.

## Conventions

Codeowner `@timmaurice`, Conventional Commits, no Co-Authored-By trailer. Card translations live in `frontend/src/translation/` and must be registered in `localize.ts`; integration translations in `custom_components/snowsure/translations/` (en/de, keep key parity).
