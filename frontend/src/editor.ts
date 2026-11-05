import { LitElement, TemplateResult, html, nothing, unsafeCSS } from 'lit';
import { property, state } from 'lit/decorators.js';
import { ForecastBand, HomeAssistant, LovelaceCardEditor, SnowsureCardConfig } from './types';
import { resortEntities } from './entities';
import { formatNumber, toNumber } from './format';
import {
  DEFAULTS,
  DEFAULT_STATS,
  EDITOR_ELEMENT_NAME,
  FORECAST_BANDS,
  MAX_FORECAST_DAYS,
  STAT_KEYS,
  withoutDefaults,
} from './defaults';
import { localize } from './localize';
import { fireEvent } from './utils';
import editorStyles from './styles/editor.styles.scss';

interface SchemaItem {
  name?: string;
  type?: string;
  title?: string;
  icon?: string;
  required?: boolean;
  selector?: Record<string, unknown>;
  schema?: SchemaItem[];
}

/** Select value for "no forecast_band": SnowSure's own forecast point. Never written to the config. */
export const AUTO_BAND = 'auto';

export class SnowsureCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: SnowsureCardConfig;

  static styles = unsafeCSS(editorStyles);

  public setConfig(config: SnowsureCardConfig): void {
    this._config = { ...DEFAULTS, stats: DEFAULT_STATS, ...config };
  }

  /**
   * Built per render: one expandable per part of the card, in the card's
   * order, titled in the user's language. Options that belong to a part only
   * show while it is on, and the forecast options follow the picked resort.
   */
  public schema(): SchemaItem[] {
    const hass = this.hass;
    const c = { ...DEFAULTS, ...this._config };
    const section = (key: string, icon: string, schema: SchemaItem[]): SchemaItem => ({
      type: 'expandable',
      title: localize(hass, `editor.section.${key}`),
      icon,
      schema,
    });
    const toggle = (name: string): SchemaItem => ({ name, selector: { boolean: {} } });

    const stats: SchemaItem[] = [toggle('show_stats')];
    if (c.show_stats) {
      stats.push({
        name: 'stats',
        selector: {
          select: {
            multiple: true,
            reorder: true,
            mode: 'dropdown',
            options: STAT_KEYS.map((key) => ({ value: key, label: localize(hass, `card.${key}`) })),
          },
        },
      });
    }

    const forecast: SchemaItem[] = [toggle('show_forecast')];
    if (c.show_forecast) {
      const resort = this._forecastInfo();
      forecast.push({
        name: 'forecast_days',
        selector: { number: { min: 1, max: resort.maxDays, step: 1, mode: 'slider' } },
      });
      // Without a resort the heights are unknown, but the choice still makes sense.
      const bands = resort.bands ?? FORECAST_BANDS;
      if (bands.length > 1) {
        const bandName = (band: ForecastBand) => localize(hass, `card.band.${band}`);
        forecast.push({
          name: 'forecast_band',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                {
                  value: AUTO_BAND,
                  label: resort.point
                    ? localize(hass, 'editor.band_auto_named', { band: bandName(resort.point) })
                    : localize(hass, 'editor.band_auto'),
                },
                ...bands.map((band) => {
                  const metres = resort.elevations?.[band];
                  return {
                    value: band,
                    label:
                      metres === undefined
                        ? bandName(band)
                        : `${bandName(band)} · ${formatNumber(metres, hass, { maximumFractionDigits: 0 })} m`,
                  };
                }),
              ],
            },
          },
        });
      }
    }

    // The avalanche level sits in the mountain while that is on, so its switch does too.
    const header: SchemaItem[] = [
      toggle('show_score'),
      toggle('show_image'),
      toggle('show_weather'),
      toggle('show_mountain'),
    ];
    const more: SchemaItem[] = [];
    (c.show_mountain ? header : more).push(toggle('show_avalanche'));
    more.push(toggle('show_webcams'));
    const top: SchemaItem[] = [
      { name: 'device', selector: { device: { filter: [{ integration: 'snowsure' }] } } },
      { name: 'title', selector: { text: {} } },
      toggle('compact'),
    ];
    // Compact shows the header and the mountain: only their switches apply.
    if (c.compact) {
      return [
        ...top,
        section('header', 'mdi:image-filter-hdr', [
          toggle('show_score'),
          toggle('show_image'),
          toggle('show_avalanche'),
        ]),
      ];
    }
    return [
      ...top,
      section('header', 'mdi:image-filter-hdr', header),
      section('stats', 'mdi:view-grid-outline', stats),
      section('forecast', 'mdi:weather-snowy-heavy', forecast),
      section(c.show_mountain ? 'webcams' : 'more', 'mdi:webcam', more),
    ];
  }

  /**
   * What the picked resort's forecast offers: how many days (7, or 14 with a
   * Pro key), SnowSure's own forecast point and the heights of the bands.
   */
  private _forecastInfo(): {
    maxDays: number;
    point?: ForecastBand;
    bands?: ForecastBand[];
    elevations?: Partial<Record<ForecastBand, number>>;
  } {
    const forecast = this.hass ? resortEntities(this.hass, this._config?.device).byKey.forecast_7d : undefined;
    if (!forecast) return { maxDays: MAX_FORECAST_DAYS };
    const attrs = forecast.attributes;
    const daily = Array.isArray(attrs.daily) ? attrs.daily.length : 0;
    const raw = (attrs.band_elevations ?? {}) as Record<string, unknown>;
    const elevations: Partial<Record<ForecastBand, number>> = {};
    for (const band of FORECAST_BANDS) {
      const metres = toNumber(raw[band]);
      if (metres !== null) elevations[band] = metres;
    }
    const point = FORECAST_BANDS.find((band) => band === attrs.point_band);
    const bands = FORECAST_BANDS.filter((band) => band in elevations);
    return {
      maxDays: daily > 0 ? Math.min(daily, MAX_FORECAST_DAYS) : MAX_FORECAST_DAYS,
      point,
      bands: bands.length ? bands : undefined,
      elevations,
    };
  }

  private _computeLabel = (item: SchemaItem): string => (item.name ? localize(this.hass, `editor.${item.name}`) : '');

  private _computeHelper = (item: SchemaItem): string =>
    item.name === 'show_webcams' ? localize(this.hass, 'editor.webcams_helper') : '';

  private _valueChanged(ev: CustomEvent<{ value: Partial<SnowsureCardConfig> }>): void {
    ev.stopPropagation();
    if (!this._config) return;
    const config = { ...this._config, ...ev.detail.value };
    // Cleared or automatic both mean SnowSure's own forecast point.
    if (!config.forecast_band || config.forecast_band === (AUTO_BAND as string)) delete config.forecast_band;
    this._config = config;
    fireEvent(this, 'config-changed', { config: withoutDefaults(this._config) });
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing;
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${{ ...this._config, forecast_band: this._config.forecast_band ?? AUTO_BAND }}
        .schema=${this.schema()}
        .computeLabel=${this._computeLabel}
        .computeHelper=${this._computeHelper}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }
}

if (!customElements.get(EDITOR_ELEMENT_NAME)) {
  customElements.define(EDITOR_ELEMENT_NAME, SnowsureCardEditor);
}
