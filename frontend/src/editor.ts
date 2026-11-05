import { LitElement, TemplateResult, html, nothing, unsafeCSS } from 'lit';
import { property, state } from 'lit/decorators.js';
import { ForecastBand, HomeAssistant, LovelaceCardEditor, SnowsureCardConfig } from './types';
import { PLATFORM, resortEntities } from './entities';
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

/** A webcam of the picked resort from the entity registry, disabled ones included. */
export interface WebcamEntry {
  entity_id: string;
  name: string;
  disabled: boolean;
}

interface RegistryEntry {
  entity_id: string;
  device_id: string | null;
  platform: string;
  translation_key: string | null;
  original_name: string | null;
  name: string | null;
  disabled_by: string | null;
}

export class SnowsureCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: SnowsureCardConfig;
  /** Every webcam of the picked resort, also the ones the integration leaves disabled; per device. */
  @state() private _webcams?: { device: string; entries: WebcamEntry[] };

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
    const cams = this._webcamOptions();
    if (c.show_webcams && cams.length) {
      more.push({
        name: 'webcams',
        selector: {
          select: {
            multiple: true,
            reorder: true,
            mode: 'dropdown',
            options: cams.map((cam) => ({
              value: cam.entity_id,
              label: cam.disabled ? localize(hass, 'editor.webcam_disabled', { name: cam.name }) : cam.name,
            })),
          },
        },
      });
    }

    return [
      { name: 'device', selector: { device: { filter: [{ integration: 'snowsure' }] } } },
      { name: 'title', selector: { text: {} } },
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

  /**
   * The picked resort's webcams: from the entity registry when the user may
   * read it (so the disabled ones can be picked), else the enabled ones.
   */
  private _webcamOptions(): WebcamEntry[] {
    const device = this._config?.device;
    if (!this.hass || !device) return [];
    if (this._webcams?.device === device) return this._webcams.entries;
    void this._loadWebcams(device);
    return resortEntities(this.hass, device).webcams.map((cam) => ({
      entity_id: cam.entity_id,
      name: String(cam.attributes.camera ?? cam.attributes.friendly_name ?? cam.entity_id),
      disabled: false,
    }));
  }

  private _loading?: string;

  private async _loadWebcams(device: string): Promise<void> {
    if (!this.hass?.callWS || this._loading === device) return;
    this._loading = device;
    try {
      const registry = await this.hass.callWS<RegistryEntry[]>({ type: 'config/entity_registry/list' });
      const entries = registry
        .filter(
          (entry) => entry.platform === PLATFORM && entry.device_id === device && entry.translation_key === 'webcam',
        )
        .map((entry) => ({
          entity_id: entry.entity_id,
          // "Webcam Gornergrat (3135m)": the entity name carries the platform word.
          name: (entry.name ?? entry.original_name ?? entry.entity_id).replace(/^webcam\s+/i, ''),
          disabled: entry.disabled_by !== null,
        }));
      if (this._config?.device === device) this._webcams = { device, entries };
    } catch {
      // Not an admin: the enabled webcams from the states are all there is.
    } finally {
      this._loading = undefined;
    }
  }

  /** Picking a disabled webcam enables it; Home Assistant reloads the entry about 30 s later. */
  private async _enablePicked(picked: string[] | undefined): Promise<void> {
    const list = this._webcams;
    if (!list || !picked?.length || !this.hass?.callWS) return;
    const disabled = list.entries.filter((entry) => entry.disabled && picked.includes(entry.entity_id));
    if (!disabled.length) return;
    for (const entry of disabled) {
      try {
        await this.hass.callWS({
          type: 'config/entity_registry/update',
          entity_id: entry.entity_id,
          disabled_by: null,
        });
        entry.disabled = false;
      } catch {
        // Left disabled; the card skips webcams without a state.
      }
    }
    this._webcams = { ...list, entries: [...list.entries] };
  }

  private _computeLabel = (item: SchemaItem): string => (item.name ? localize(this.hass, `editor.${item.name}`) : '');

  private _computeHelper = (item: SchemaItem): string => {
    if (item.name !== 'webcams') return '';
    const anyDisabled = this._webcams?.entries.some((entry) => entry.disabled);
    return localize(this.hass, anyDisabled ? 'editor.webcams_helper_disabled' : 'editor.webcams_helper');
  };

  private _valueChanged(ev: CustomEvent<{ value: Partial<SnowsureCardConfig> }>): void {
    ev.stopPropagation();
    if (!this._config) return;
    const config = { ...this._config, ...ev.detail.value };
    // Cleared or automatic both mean SnowSure's own forecast point.
    if (!config.forecast_band || config.forecast_band === (AUTO_BAND as string)) delete config.forecast_band;
    this._config = config;
    void this._enablePicked(config.webcams);
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
