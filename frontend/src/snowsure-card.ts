import { LitElement, TemplateResult, html, nothing, svg, unsafeCSS } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  ForecastBand,
  ForecastDay,
  HassEntity,
  HomeAssistant,
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
  SnowsureCardConfig,
  StatKey,
} from './types';
import {
  DEFAULTS,
  DEFAULT_STATS,
  EDITOR_ELEMENT_NAME,
  ELEMENT_NAME,
  MAX_FORECAST_DAYS,
  FORECAST_BANDS,
  MAX_WEBCAMS,
  STAT_KEYS,
} from './defaults';
import { ResortEntities, isAvailable, resortEntities, snowsureDevices } from './entities';
import { entityDigits, formatDate, formatNumber, formatWeekday, toNumber } from './format';
import { localize, tryLocalize } from './localize';
import { snowQualityText, weatherIcon, weatherText } from './weather';
import { fireEvent } from './utils';
import { customStatIcon } from './icons';
import styles from './styles/card.styles.scss';

const SNOWSURE_URL = 'https://www.snowsure.ai';

/** EAWS danger level colours (1 low ... 5 very high). */
const AVALANCHE_COLORS: Record<number, string> = {
  1: '#ccff66',
  2: '#ffff00',
  3: '#ff9900',
  4: '#ff0000',
  5: '#a00000',
};

const STAT_ICONS: Record<StatKey, string> = {
  // Fallbacks only: the depth tiles draw their own icons (icons.ts).
  depth_base: 'mdi:arrow-collapse-down',
  depth_mid: 'mdi:arrow-collapse-vertical',
  depth_summit: 'mdi:image-filter-hdr',
  snowfall_24h: 'mdi:weather-snowy',
  snowfall_7d: 'mdi:weather-snowy-heavy',
  snowfall_season: 'mdi:snowflake',
  forecast_7d: 'mdi:calendar-week',
  runs_open: 'mdi:ski',
  lifts_open: 'mdi:gondola',
  temperature_base: 'mdi:thermometer',
  temperature_summit: 'mdi:thermometer-chevron-up',
  snow_quality: 'mdi:snowflake-variant',
};

/** Temperature colour scale in °C, cold to warm, for the forecast lines. */
const TEMPERATURE_COLORS: [number, string][] = [
  [-20, '#7c4dff'],
  [-10, '#2979ff'],
  [-4, '#29b6f6'],
  [0, '#4dd0e1'],
  [4, '#ffd54f'],
  [10, '#ffa726'],
  [20, '#ef5350'],
];

/** The scale's colour at `celsius`, interpolated between its neighbours. */
export function temperatureColor(celsius: number): string {
  const scale = TEMPERATURE_COLORS;
  if (celsius <= scale[0][0]) return scale[0][1];
  for (let i = 1; i < scale.length; i++) {
    const [to, toColor] = scale[i];
    if (celsius > to) continue;
    const [from, fromColor] = scale[i - 1];
    const share = (celsius - from) / (to - from);
    const channel = (color: string, offset: number) => parseInt(color.slice(offset, offset + 2), 16);
    const mix = [1, 3, 5].map((offset) =>
      Math.round(channel(fromColor, offset) + (channel(toColor, offset) - channel(fromColor, offset)) * share),
    );
    return `#${mix.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return scale[scale.length - 1][1];
}

const TREND_ICONS: Record<string, string> = {
  improving: 'mdi:trending-up',
  stable: 'mdi:trending-neutral',
  declining: 'mdi:trending-down',
  worsening: 'mdi:trending-down',
};

const CM_PER_INCH = 2.54;

declare global {
  interface Window {
    customCards?: {
      type: string;
      name: string;
      description: string;
      documentationURL?: string;
      preview?: boolean;
      getEntitySuggestion?: (hass: HomeAssistant, entityId: string) => { config: Record<string, unknown> } | null;
    }[];
  }
}

export class SnowsureCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: SnowsureCardConfig;
  /** Band picked on the card itself; wins over the configured one until the config changes. */
  @state() private _band?: ForecastBand;
  /** The trail map dialog, while it is open: which map, and whether it is zoomed. */
  @state() private _trailMap?: { index: number; zoom: boolean };
  /** Where the user clicked to zoom (0..1 of the image), to scroll there afterwards. */
  private _zoomFocus?: { x: number; y: number };

  static styles = unsafeCSS(styles);

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import('./editor');
    return document.createElement(EDITOR_ELEMENT_NAME) as LovelaceCardEditor;
  }

  /**
   * The first SnowSure resort, preferring the entities HA hands in. Never a
   * config that renders an error: without a resort the card shows a hint.
   */
  public static getStubConfig(hass?: HomeAssistant, entities?: string[]): Record<string, unknown> {
    const [device] = snowsureDevices(hass, entities);
    return device ? { device } : {};
  }

  /** Offer the card in the picker for SnowSure entities only, with the stub's config. */
  public static getEntitySuggestion(hass: HomeAssistant, entityId: string): { config: Record<string, unknown> } | null {
    const entry = hass?.entities?.[entityId];
    if (entry?.platform !== 'snowsure' || !entry.device_id) return null;
    return { config: { type: `custom:${ELEMENT_NAME}`, ...SnowsureCard.getStubConfig(hass, [entityId]) } };
  }

  /** Never throws for a missing device: the picker preview must not turn into an error card. */
  public setConfig(config: SnowsureCardConfig): void {
    if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
    const days = toNumber(config.forecast_days);
    const stats = Array.isArray(config.stats)
      ? config.stats.filter((key): key is StatKey => STAT_KEYS.includes(key))
      : DEFAULT_STATS;
    this._config = {
      ...DEFAULTS,
      ...config,
      stats,
      forecast_days:
        days === null ? DEFAULTS.forecast_days : Math.min(Math.max(Math.round(days), 1), MAX_FORECAST_DAYS),
      forecast_band: FORECAST_BANDS.includes(config.forecast_band as ForecastBand) ? config.forecast_band : undefined,
    };
    this._band = undefined;
  }

  /** Masonry needs a number; a rough count of the sections that are switched on. */
  public getCardSize(): number {
    if (!this._config) return 3;
    const c = this._config;
    return (
      2 +
      (c.show_weather ? 1 : 0) +
      (c.show_stats ? Math.ceil((c.stats?.length ?? 0) / 3) : 0) +
      (c.show_forecast ? 2 : 0) +
      (c.show_avalanche ? 1 : 0) +
      (c.show_webcams ? 2 : 0)
    );
  }

  /** Sections: HA measures the rendered height (`rows: 'auto'`) instead of a guess that drifts. */
  public getGridOptions(): LovelaceGridOptions {
    return { columns: 'full', min_columns: 6, rows: 'auto', min_rows: 2 };
  }

  private _moreInfo(entity: HassEntity | undefined): void {
    if (entity) fireEvent(this, 'hass-more-info', { entityId: entity.entity_id });
  }

  /** A numeric state with its unit, formatted for the user's locale, or "–". */
  private _value(entity: HassEntity | undefined): string {
    if (!this.hass || !isAvailable(entity)) return '–';
    const number = toNumber(entity.state);
    if (number === null) return entity.state;
    const digits = entityDigits(this.hass, entity.entity_id, entity.state);
    const text = formatNumber(number, this.hass, { maximumFractionDigits: digits, minimumFractionDigits: digits });
    const unit = entity.attributes.unit_of_measurement;
    return unit ? `${text} ${unit}` : text;
  }

  /** "open / total" for lifts and runs. */
  private _openOfTotal(entity: HassEntity | undefined): string {
    const hass = this.hass!;
    const total = toNumber(entity?.attributes.total);
    const open = isAvailable(entity) ? toNumber(entity.state) : null;
    return `${open === null ? '–' : formatNumber(open, hass)}${total === null ? '' : ` / ${formatNumber(total, hass)}`}`;
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this._config || !this.hass) return nothing;

    const resort = resortEntities(this.hass, this._config.device);
    const device = this._config.device ? this.hass.devices?.[this._config.device] : undefined;
    const name = this._config.title || device?.name_by_user || device?.name || 'SnowSure';

    if (!this._config.device || Object.keys(resort.byKey).length === 0) {
      const key = this._config.device ? 'card.resort_not_found' : 'card.select_resort';
      return html`<ha-card .header=${this._config.title}>
        <div class="card-content hint">${localize(this.hass, key)}</div>
      </ha-card>`;
    }

    const c = this._config;
    return html`
      <ha-card>
        ${this._renderHeader(name, resort)}
        <div class="card-content">
          ${c.show_weather ? this._renderWeather(resort) : nothing}
          ${c.show_stats ? this._renderStats(resort) : nothing}
          ${c.show_forecast ? this._renderForecast(resort) : nothing}
          ${c.show_avalanche ? this._renderAvalanche(resort) : nothing}
          ${c.show_webcams ? this._renderWebcams(resort) : nothing}
          ${this._renderFooter(device?.configuration_url, resort)}
        </div>
        ${this._trailMap ? this._renderTrailMap(name, resort, this._trailMap) : nothing}
      </ha-card>
    `;
  }

  protected updated(): void {
    const dialog = this.shadowRoot?.querySelector<HTMLDialogElement>('dialog.trail-map');
    if (!dialog) return;
    if (!dialog.open) {
      // A modal in the top layer escapes the dashboard's stacking and overflow.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    const focus = this._zoomFocus;
    const view = dialog.querySelector<HTMLElement>('.map-view.zoomed');
    if (focus && view) {
      this._zoomFocus = undefined;
      const img = view.querySelector('img');
      const centre = () =>
        view.scrollTo(
          focus.x * view.scrollWidth - view.clientWidth / 2,
          focus.y * view.scrollHeight - view.clientHeight / 2,
        );
      if (img && !img.complete) img.addEventListener('load', centre, { once: true });
      else centre();
    }
  }

  /** Plain clicks open the dialog; ctrl/cmd/middle clicks keep the browser's new tab. */
  private _openTrailMap(ev: MouseEvent): void {
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    this._trailMap = { index: 0, zoom: false };
  }

  private _closeTrailMap(): void {
    const dialog = this.shadowRoot?.querySelector<HTMLDialogElement>('dialog.trail-map');
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    this._trailMap = undefined;
  }

  private _toggleZoom(ev: MouseEvent): void {
    if (!this._trailMap) return;
    const img = ev.currentTarget instanceof HTMLElement ? ev.currentTarget.querySelector('img') : null;
    if (!this._trailMap.zoom && img) {
      const box = img.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        this._zoomFocus = {
          x: Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)),
          y: Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height)),
        };
      }
    }
    this._trailMap = { ...this._trailMap, zoom: !this._trailMap.zoom };
  }

  /** Trail map image entities that can be shown, in SnowSure's order. */
  private _trailMaps(resort: ResortEntities): HassEntity[] {
    return resort.trailMaps.filter((map) => isAvailable(map) && map.attributes.entity_picture);
  }

  /** The PDF to open in a new tab: the shown map's, else the resort's main map. */
  private _trailMapPdf(resort: ResortEntities, map?: HassEntity): string | undefined {
    const urls = [map?.attributes.pdf_url, resort.byKey.open?.attributes.trail_map];
    return urls.find((url): url is string => typeof url === 'string' && url.startsWith('https://'));
  }

  private _renderTrailMap(
    name: string,
    resort: ResortEntities,
    view: { index: number; zoom: boolean },
  ): TemplateResult {
    const hass = this.hass!;
    const maps = this._trailMaps(resort);
    const map = maps[Math.min(view.index, maps.length - 1)];
    const pdf = this._trailMapPdf(resort, map);
    const newTab = pdf ?? (map?.attributes.entity_picture as string | undefined);
    const title = `${localize(hass, 'card.trail_map')} · ${name}`;
    const label = (entry: HassEntity) => String(entry.attributes.label ?? entry.attributes.friendly_name ?? '');
    return html`
      <dialog
        class="trail-map"
        aria-label=${title}
        @close=${this._closeTrailMap}
        @click=${(ev: MouseEvent) => {
          // A click on the backdrop lands on the dialog itself.
          if (ev.target === ev.currentTarget) this._closeTrailMap();
        }}
      >
        <div class="dialog-header">
          <span class="dialog-title">${title}</span>
          ${
            newTab
              ? html`<a
                  class="icon-button"
                  href=${newTab}
                  target="_blank"
                  rel="noopener noreferrer"
                  title=${localize(hass, 'card.open_in_new_tab')}
                  ><ha-icon icon="mdi:open-in-new"></ha-icon
                ></a>`
              : nothing
          }
          <button class="icon-button close" title=${localize(hass, 'card.close')} @click=${this._closeTrailMap}>
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        ${
          maps.length > 1
            ? html`<div class="map-tabs" role="tablist">
                ${maps.map(
                  (entry, index) =>
                    html`<button
                      role="tab"
                      class="map-tab ${entry === map ? 'active' : ''}"
                      aria-selected=${entry === map ? 'true' : 'false'}
                      @click=${() => (this._trailMap = { index, zoom: false })}
                    >
                      ${label(entry)}
                    </button>`,
                )}
              </div>`
            : nothing
        }
        ${
          map
            ? html`<div
                class="map-view ${view.zoom ? 'zoomed' : ''}"
                title=${localize(hass, view.zoom ? 'card.zoom_out' : 'card.zoom_in')}
                @click=${this._toggleZoom}
              >
                <img src=${map.attributes.entity_picture as string} alt=${label(map)} />
              </div>`
            : pdf
              ? html`<iframe src=${pdf} title=${title} referrerpolicy="no-referrer"></iframe>`
              : nothing
        }
      </dialog>
    `;
  }

  /** SnowSure's terms require the credit with a visible link wherever the data is shown. */
  private _renderHeader(name: string, resort: ResortEntities): TemplateResult {
    const hass = this.hass!;
    const { open, score, season_opening: opening, resort_image: image } = resort.byKey;
    const scoreValue = isAvailable(score) ? toNumber(score.state) : null;
    const color = (score?.attributes.rating_color as string | undefined) || 'var(--primary-color)';
    const showScore = this._config!.show_score && scoreValue !== null;
    const trend = score?.attributes.trend as string | undefined;
    const picture = image?.attributes.entity_picture as string | undefined;
    const background = this._config!.show_image && isAvailable(image) && picture ? picture : undefined;

    // A closed resort says when it opens, if that is still ahead.
    const isClosed = isAvailable(open) && open.state === 'off';
    const opensOn = isClosed && isAvailable(opening) && opening.state > new Date().toISOString().slice(0, 10);

    return html`
      <div class="header ${background ? 'with-image' : ''}" style=${background ? `--hero: url("${background}")` : ''}>
        <div class="title">
          <div class="name">${name}</div>
          <div class="badges">
            ${
              isAvailable(open)
                ? html`<button
                    class="chip ${open.state === 'on' ? 'open' : 'closed'}"
                    @click=${() => this._moreInfo(open)}
                  >
                    ${localize(hass, open.state === 'on' ? 'card.open' : 'card.closed')}
                  </button>`
                : nothing
            }
            ${
              opensOn
                ? html`<span class="season"
                    >${localize(hass, 'card.season_opens', { date: formatDate(opening.state, hass) })}</span
                  >`
                : nothing
            }
          </div>
          ${
            showScore && score?.attributes.tagline
              ? html`<div class="tagline">${score.attributes.tagline as string}</div>`
              : nothing
          }
        </div>
        ${
          showScore
            ? html`<button
                class="score"
                style="--score-color: ${color}"
                title=${localize(hass, 'card.score')}
                @click=${() => this._moreInfo(score)}
              >
                <span class="score-value">${formatNumber(scoreValue!, hass, { maximumFractionDigits: 0 })}</span>
                <span class="score-rating">${(score?.attributes.rating as string | undefined) ?? ''}</span>
                ${
                  trend && TREND_ICONS[trend]
                    ? html`<ha-icon
                        class="trend ${trend}"
                        .icon=${TREND_ICONS[trend]}
                        title=${localize(hass, `card.trend.${trend}`)}
                      ></ha-icon>`
                    : nothing
                }
              </button>`
            : nothing
        }
      </div>
    `;
  }

  private _renderWeather(resort: ResortEntities): TemplateResult | typeof nothing {
    const hass = this.hass!;
    const { weather, temperature_base: valley, temperature_summit: summit } = resort.byKey;
    if (!isAvailable(weather) && !isAvailable(valley) && !isAvailable(summit)) return nothing;
    const temp = (entity: HassEntity | undefined) => {
      if (!isAvailable(entity)) return '–';
      const number = toNumber(entity.state);
      return number === null ? '–' : `${formatNumber(number, hass, { maximumFractionDigits: 0 })}°`;
    };
    return html`
      <button class="weather" @click=${() => this._moreInfo(weather ?? summit)}>
        <ha-icon .icon=${weatherIcon(isAvailable(weather) ? weather.state : undefined)}></ha-icon>
        <span class="weather-text">${isAvailable(weather) ? weatherText(hass, weather.state) : ''}</span>
        <span class="weather-temps">
          ${valley ? html`<span>${localize(hass, 'card.valley')} ${temp(valley)}</span>` : nothing}
          ${summit ? html`<span>${localize(hass, 'card.summit')} ${temp(summit)}</span>` : nothing}
        </span>
      </button>
    `;
  }

  private _statValue(key: StatKey, entity: HassEntity | undefined): string {
    if (key === 'lifts_open' || key === 'runs_open') return this._openOfTotal(entity);
    if (key === 'snow_quality') return isAvailable(entity) ? snowQualityText(this.hass, entity.state) : '–';
    return this._value(entity);
  }

  private _renderStats(resort: ResortEntities): TemplateResult | typeof nothing {
    const hass = this.hass!;
    const tiles = (this._config!.stats ?? DEFAULT_STATS).filter((key) => resort.byKey[key]);
    if (tiles.length === 0) return nothing;
    return html`
      <div class="stats">
        ${tiles.map((key) => {
          const entity = resort.byKey[key];
          const vsAverage = key === 'depth_base' ? toNumber(entity?.attributes.vs_average_pct) : null;
          return html`
            <button class="stat" @click=${() => this._moreInfo(entity)}>
              ${customStatIcon(key) ?? html`<ha-icon .icon=${STAT_ICONS[key]}></ha-icon>`}
              <span class="stat-value">${this._statValue(key, entity)}</span>
              <span class="stat-label">${localize(hass, `card.${key}`)}</span>
              ${
                vsAverage !== null
                  ? html`<span class="stat-extra"
                      >${localize(hass, 'card.vs_average', {
                        pct: formatNumber(vsAverage, hass, { maximumFractionDigits: 0 }),
                      })}</span
                    >`
                  : nothing
              }
            </button>
          `;
        })}
      </div>
    `;
  }

  private _renderForecast(resort: ResortEntities): TemplateResult | typeof nothing {
    const hass = this.hass!;
    const { forecast_7d: forecast, temperature_summit: summit, forecast_confidence: confidence } = resort.byKey;
    const daily = (forecast?.attributes.daily as ForecastDay[] | undefined) ?? [];
    if (!Array.isArray(daily) || daily.length === 0) return nothing;
    const days = daily.slice(0, this._config!.forecast_days);

    // The daily attribute is always cm / °C / m. Convert only for display, and
    // only when HA shows the matching sensors in imperial units.
    const inches = forecast?.attributes.unit_of_measurement === 'in';
    const fahrenheit = summit?.attributes.unit_of_measurement === '°F';
    const snow = (cm: number) => (inches ? cm / CM_PER_INCH : cm);
    const temp = (c: number) => (fahrenheit ? (c * 9) / 5 + 32 : c);
    const snowUnit = inches ? 'in' : 'cm';

    // Snowfall per day for the picked band. The plain `snowfall` is SnowSure's
    // own forecast point, the fallback whenever the bands are missing.
    const elevations = (forecast?.attributes.band_elevations ?? {}) as Partial<Record<ForecastBand, number>>;
    const point = (forecast?.attributes.point_band as ForecastBand | undefined) ?? 'mid';
    const bands = FORECAST_BANDS.filter(
      (band) => toNumber(elevations[band]) !== null && days.some((day) => toNumber(day[`snowfall_${band}`]) !== null),
    );
    const wanted = this._band ?? this._config!.forecast_band ?? point;
    const band = bands.includes(wanted) ? wanted : bands.includes(point) ? point : undefined;
    const amounts = days.map(
      (day) =>
        (band ? toNumber(day[`snowfall_${band}`]) : null) ??
        (band === point || !band ? toNumber(day.snowfall) : null) ??
        0,
    );
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    // A floor keeps a 0.3 cm drizzle from filling the whole bar.
    const scale = Math.max(...amounts, 5);
    const confidenceLabel = isAvailable(confidence) ? confidence.state : undefined;

    return html`
      <div class="section-title">
        <span>${localize(hass, 'card.forecast')}</span>
        <span class="secondary"
          >${localize(hass, 'card.forecast_total', {
            value: `${formatNumber(snow(total), hass, { maximumFractionDigits: 1 })} ${snowUnit}`,
            days: days.length,
          })}</span
        >
        ${
          confidenceLabel
            ? html`<button class="confidence ${confidenceLabel}" @click=${() => this._moreInfo(confidence)}>
                ${localize(hass, `card.confidence.${confidenceLabel}`)}
              </button>`
            : nothing
        }
      </div>
      <button class="forecast" style="--days: ${days.length}" @click=${() => this._moreInfo(forecast)}>
        ${days.map((day, index) => {
          const amount = amounts[index];
          const freezing = toNumber(day.freezing_level);
          const tooltip = [
            weatherText(hass, day.conditions),
            freezing !== null ? `0° ${formatNumber(freezing, hass, { maximumFractionDigits: 0 })} m` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          // SnowSure's first forecast day is the resort's today; the viewer's
          // clock can be a day ahead (Europe looking at Colorado).
          const isToday = index === 0;
          return html`
            <div class="day ${isToday ? 'today' : ''}" title=${tooltip}>
              <span class="weekday">${isToday ? localize(hass, 'card.today') : formatWeekday(day.date, hass)}</span>
              <div class="bar-track">
                <div class="bar" style="height: ${Math.round((amount / scale) * 100)}%"></div>
              </div>
              <span class="amount"
                >${
                  amount > 0
                    ? formatNumber(snow(amount), hass, { maximumFractionDigits: inches || snow(amount) < 1 ? 1 : 0 })
                    : ''
                }</span
              >
            </div>
          `;
        })}
        ${this._renderTemperatureChart(days, temp)}
      </button>
      ${bands.length > 1 ? this._renderBandSwitch(bands, band, elevations, inches) : nothing}
    `;
  }

  /**
   * Valley / mid / summit, each with its height, like snowsure.ai's elevation
   * picker. It sits under the bars and is labelled as snowfall: SnowSure has
   * per-band snow but only one temperature series.
   */
  private _renderBandSwitch(
    bands: ForecastBand[],
    active: ForecastBand | undefined,
    elevations: Partial<Record<ForecastBand, number>>,
    imperial: boolean,
  ): TemplateResult {
    const hass = this.hass!;
    const height = (meters: number) =>
      imperial
        ? `${formatNumber(meters * 3.28084, hass, { maximumFractionDigits: 0 })} ft`
        : `${formatNumber(meters, hass, { maximumFractionDigits: 0 })} m`;
    return html`
      <div class="band-switch" role="radiogroup" aria-label=${localize(hass, 'card.snowfall_at')}>
        <span class="band-label"><ha-icon icon="mdi:snowflake"></ha-icon>${localize(hass, 'card.snowfall_at')}</span>
        ${bands.map(
          (band) => html`
            <button
              role="radio"
              class="band ${band === active ? 'active' : ''}"
              aria-checked=${band === active ? 'true' : 'false'}
              @click=${() => (this._band = band)}
            >
              <span class="band-name">${localize(hass, `card.band.${band}`)}</span>
              <span class="band-height">${height(elevations[band]!)}</span>
            </button>
          `,
        )}
      </div>
    `;
  }

  /**
   * Max (solid) and min (dashed) temperature lines over the snowfall bars,
   * coloured by temperature (cold blue through 0° to warm orange). The SVG
   * stretches to the columns, so the lines are drawn in a 100-units-per-day box
   * with non-scaling strokes; dots and labels are HTML placed in percent.
   */
  private _renderTemperatureChart(
    days: ForecastDay[],
    temp: (celsius: number) => number,
  ): TemplateResult | typeof nothing {
    const hass = this.hass!;
    // Positions and colours work in °C; only the labels follow the user's unit.
    const series = (pick: (day: ForecastDay) => unknown) => days.map((day) => toNumber(pick(day)));
    const max = series((day) => day.temp_max);
    const min = series((day) => day.temp_min);
    const values = [...max, ...min].filter((value): value is number => value !== null);
    if (values.length === 0) return nothing;

    const high = Math.max(...values);
    const low = Math.min(...values);
    // Room above the warmest and below the coldest point for their labels.
    const y = (value: number) => (high === low ? 50 : 22 + ((high - value) / (high - low)) * 56);
    const x = (index: number) => ((index + 0.5) / days.length) * 100;

    const line = (points: (number | null)[]) => {
      const known = points
        .map((value, index) => (value === null ? null : { x: (index + 0.5) * 100, y: y(value) }))
        .filter((point): point is { x: number; y: number } => point !== null);
      if (known.length < 2) return '';
      // Monotone cubic (Fritsch–Carlson) through the points: smooth, but it never
      // swings beyond its neighbours, so the curve shows no temperature the
      // forecast does not have.
      const slopes = known.slice(1).map((p, i) => (p.y - known[i].y) / (p.x - known[i].x));
      const tangents = known.map((_, i) => {
        if (i === 0) return slopes[0];
        if (i === known.length - 1) return slopes[i - 1];
        const [a, b] = [slopes[i - 1], slopes[i]];
        return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
      });
      let d = `M${known[0].x} ${known[0].y}`;
      for (let i = 0; i < known.length - 1; i++) {
        const [p1, p2] = [known[i], known[i + 1]];
        const third = (p2.x - p1.x) / 3;
        d += ` C${p1.x + third} ${p1.y + tangents[i] * third} ${p2.x - third} ${p2.y - tangents[i + 1] * third} ${p2.x} ${p2.y}`;
      }
      return d;
    };

    // The gradient runs top (warm) to bottom (cold) in the SVG's own units, so
    // every point of a line gets the colour of its temperature.
    const stops = [high, ...TEMPERATURE_COLORS.map(([celsius]) => celsius).filter((c) => c < high && c > low), low]
      .map((celsius) => ({ offset: high === low ? 0.5 : y(celsius) / 100, color: temperatureColor(celsius) }))
      .sort((a, b) => a.offset - b.offset);

    const label = (celsius: number) => {
      const value = temp(celsius);
      // -0.3 would round to "-0".
      return `${formatNumber(Math.abs(value) < 0.5 ? 0 : value, hass, { maximumFractionDigits: 0 })}°`;
    };
    const marks = (points: (number | null)[], kind: 'max' | 'min') =>
      points.map((value, index) => {
        if (value === null) return nothing;
        const place = `left: ${x(index)}%; top: ${y(value)}%; --temp-color: ${temperatureColor(value)}`;
        return html`<span class="temp-dot ${kind}" style=${place}></span
          ><span class="temp-label ${kind}" style=${place}>${label(value)}</span>`;
      });

    return html`
      <div class="temp-chart" aria-hidden="true">
        <svg viewBox="0 0 ${days.length * 100} 100" preserveAspectRatio="none">
          ${svg`<defs>
              <linearGradient id="temp-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
                ${stops.map((stop) => svg`<stop offset=${stop.offset} stop-color=${stop.color} />`)}
              </linearGradient>
            </defs>
            <path class="temp-line max" stroke="url(#temp-gradient)" d=${line(max)} />
            <path class="temp-line min" stroke="url(#temp-gradient)" d=${line(min)} />`}
        </svg>
        ${marks(max, 'max')} ${marks(min, 'min')}
      </div>
    `;
  }

  private _renderAvalanche(resort: ResortEntities): TemplateResult | typeof nothing {
    const hass = this.hass!;
    const entity = resort.byKey.avalanche_level;
    if (!entity) return nothing;
    const level = isAvailable(entity) ? toNumber(entity.state) : null;
    if (level === null) {
      return html`<div class="avalanche none">
        <ha-icon icon="mdi:alert-octagon-outline"></ha-icon>${localize(hass, 'card.no_bulletin')}
      </div>`;
    }
    // EAWS level names in the user's language; SnowSure's label is English.
    const label =
      tryLocalize(hass, `card.avalanche_levels.${level}`) ?? localize(hass, 'card.avalanche_level', { level });
    const validUntil = entity.attributes.valid_until as string | undefined;
    // The bulletin stays until the next one is published; say so once it ran out.
    const expired = Boolean(validUntil) && new Date(validUntil!).getTime() < Date.now();
    const link = entity.attributes.link as string | undefined;
    return html`
      <button class="avalanche ${expired ? 'expired' : ''}" @click=${() => this._moreInfo(entity)}>
        <span class="level" style="--level-color: ${AVALANCHE_COLORS[level] ?? 'var(--disabled-color)'}"
          >${formatNumber(level, hass)}</span
        >
        <span class="avalanche-text">
          <span class="avalanche-title">${localize(hass, 'card.avalanche')}: ${label}</span>
          ${
            validUntil
              ? html`<span class="secondary ${expired ? 'expired' : ''}"
                  >${localize(hass, expired ? 'card.avalanche_expired' : 'card.avalanche_valid_until', {
                    date: formatDate(validUntil, hass),
                  })}</span
                >`
              : nothing
          }
        </span>
        ${
          link
            ? html`<a
                href=${link}
                target="_blank"
                rel="noopener noreferrer"
                @click=${(ev: Event) => ev.stopPropagation()}
                ><ha-icon icon="mdi:open-in-new"></ha-icon
              ></a>`
            : nothing
        }
      </button>
    `;
  }

  /** Enabled webcam entities, through Home Assistant's image proxy (no third-party request from the browser). */
  private _renderWebcams(resort: ResortEntities): TemplateResult | typeof nothing {
    const hass = this.hass!;
    const cams = resort.webcams
      .filter((cam) => isAvailable(cam) && cam.attributes.entity_picture)
      .slice(0, MAX_WEBCAMS);
    if (cams.length === 0) return nothing;
    return html`
      <div class="section-title"><span>${localize(hass, 'card.webcams')}</span></div>
      <div class="webcams">
        ${cams.map(
          (cam) => html`
            <button class="webcam" @click=${() => this._moreInfo(cam)}>
              <img src=${cam.attributes.entity_picture as string} alt="" loading="lazy" />
              <span class="webcam-name">${(cam.attributes.camera as string | undefined) ?? ''}</span>
            </button>
          `,
        )}
      </div>
    `;
  }

  /** SnowSure's terms require the credit with a visible link wherever the data is shown. */
  private _renderFooter(resortUrl: string | null | undefined, resort: ResortEntities): TemplateResult {
    const hass = this.hass!;
    const updated = resort.byKey.updated_at;
    const maps = this._trailMaps(resort);
    const trailMap = this._trailMapPdf(resort, maps[0]) ?? (maps[0]?.attributes.entity_picture as string | undefined);
    const href = resortUrl && resortUrl.startsWith(SNOWSURE_URL) ? resortUrl : SNOWSURE_URL;
    return html`
      <div class="footer">
        <span class="links">
          <a href=${href} target="_blank" rel="noopener noreferrer">${localize(hass, 'card.attribution')}</a>
          ${
            trailMap
              ? html`<a href=${trailMap} target="_blank" rel="noopener noreferrer" @click=${this._openTrailMap}
                  >${localize(hass, 'card.trail_map')}</a
                >`
              : nothing
          }
        </span>
        ${
          isAvailable(updated)
            ? html`<span>${localize(hass, 'card.updated', { date: formatDate(updated.state, hass) })}</span>`
            : nothing
        }
      </div>
    `;
  }
}

if (!customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, SnowsureCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === ELEMENT_NAME)) {
  window.customCards.push({
    type: ELEMENT_NAME,
    name: 'SnowSure Card',
    description: 'Snow depth, new snow, forecast, avalanche danger and webcams for a SnowSure ski resort.',
    documentationURL: 'https://github.com/timmaurice/snowsure',
    preview: true,
    getEntitySuggestion: (hass: HomeAssistant, entityId: string) => SnowsureCard.getEntitySuggestion(hass, entityId),
  });
}
