import { LitElement, PropertyValues, TemplateResult, html, nothing, unsafeCSS } from 'lit';
import { property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { ForecastBand, ForecastDay, HassEntity, HomeAssistant, LovelaceCard, LovelaceCardEditor } from './types';
import { FORECAST_BANDS } from './defaults';
import { isAvailable, resortEntities, snowsureDevices } from './entities';
import { formatNumber, toNumber } from './format';
import { avalancheIcon } from './icons';
import { ATTRIBUTION, SNOWSURE_URL, upstreamCredits } from './credits';
import { localize } from './localize';
import { fireEvent } from './utils';
import styles from './styles/compare.styles.scss';

export const COMPARE_ELEMENT_NAME = 'snowsure-compare-card';
export const COMPARE_EDITOR_ELEMENT_NAME = `${COMPARE_ELEMENT_NAME}-editor`;
export const COMPARE_SORTS = ['snowfall', 'score', 'depth'] as const;
export type CompareSort = (typeof COMPARE_SORTS)[number];

export interface CompareCardConfig {
  type: string;
  title?: string;
  /** device_ids of SnowSure resorts; unset or empty is every resort. */
  devices?: string[];
  /** Forecast days added up, from today. */
  days?: number;
  /** Height the snowfall is read at; unset is each resort's own forecast point. */
  band?: ForecastBand;
  sort?: CompareSort;
}

export const COMPARE_DEFAULTS = { days: 3, sort: 'snowfall' as CompareSort };
const CM_PER_INCH = 2.54;
/** Same length as the bar's width transition in compare.styles.scss. */
const MOVE_MS = 400;

/** One resort's row, everything already read from its entities. */
export interface CompareRow {
  device: string;
  name: string;
  snowfall: number | null;
  score: number | null;
  scoreColor?: string;
  depth: number | null;
  open?: boolean;
  avalanche: number | null;
  /** SnowSure's forecast point, the height read when no band is picked. */
  point: ForecastBand;
  forecast?: HassEntity;
  depthEntity?: HassEntity;
  inches: boolean;
}

/** The resort's row: snowfall over the first `days` at `band` (the forecast point as fallback). */
export function compareRow(
  hass: HomeAssistant,
  device: string,
  days: number,
  band: ForecastBand | undefined,
): CompareRow | null {
  const { byKey } = resortEntities(hass, device);
  const forecast = byKey.forecast_7d;
  if (!forecast && !byKey.score) return null;
  const daily = (forecast?.attributes.daily as ForecastDay[] | undefined) ?? [];
  const point = (forecast?.attributes.point_band as ForecastBand | undefined) ?? 'mid';
  const at = band ?? point;
  const amounts = daily
    .slice(0, days)
    .map((day) => toNumber(day[`snowfall_${at}`]) ?? (at === point ? toNumber(day.snowfall) : null));
  const known = amounts.filter((value): value is number => value !== null);
  const value = (entity: HassEntity | undefined) => (isAvailable(entity) ? toNumber(entity.state) : null);
  const device_ = hass.devices?.[device];
  return {
    device,
    name: device_?.name_by_user || device_?.name || device,
    snowfall: known.length ? known.reduce((sum, amount) => sum + amount, 0) : null,
    score: value(byKey.score),
    scoreColor: byKey.score?.attributes.rating_color as string | undefined,
    depth: value(byKey.depth_summit),
    open: isAvailable(byKey.open) ? byKey.open.state === 'on' : undefined,
    avalanche: value(byKey.avalanche_level),
    point,
    forecast,
    depthEntity: byKey.depth_summit,
    inches: forecast?.attributes.unit_of_measurement === 'in',
  };
}

/** Highest first; resorts without the value go last, by name. */
export function sortRows(rows: CompareRow[], sort: CompareSort): CompareRow[] {
  const key = (row: CompareRow) => (sort === 'score' ? row.score : sort === 'depth' ? row.depth : row.snowfall);
  return [...rows].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    if (x === null && y === null) return a.name.localeCompare(b.name);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || a.name.localeCompare(b.name);
  });
}

/**
 * "Where to this weekend?": several resorts side by side, ranked by the new
 * snow of the next days (or score, or summit depth).
 */
export class SnowsureCompareCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: CompareCardConfig;
  /** Height picked on the card; unset follows the config. */
  @state() private _band?: ForecastBand;
  /** Row tops before a height switch, keyed by device, for the move animation. */
  private _tops?: Map<string, number>;

  static styles = unsafeCSS(styles);

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    return document.createElement(COMPARE_EDITOR_ELEMENT_NAME) as LovelaceCardEditor;
  }

  public static getStubConfig(): Record<string, unknown> {
    return {};
  }

  public setConfig(config: CompareCardConfig): void {
    if (!config || typeof config !== 'object') throw new Error('Invalid configuration');
    const days = toNumber(config.days);
    this._config = {
      ...config,
      devices: Array.isArray(config.devices) ? config.devices.filter((id) => typeof id === 'string') : undefined,
      days: days === null ? COMPARE_DEFAULTS.days : Math.min(Math.max(Math.round(days), 1), 14),
      band: FORECAST_BANDS.includes(config.band as ForecastBand) ? config.band : undefined,
      sort: COMPARE_SORTS.includes(config.sort as CompareSort) ? config.sort : COMPARE_DEFAULTS.sort,
    };
    this._band = undefined;
  }

  private get _activeBand(): ForecastBand | undefined {
    return this._band ?? this._config?.band;
  }

  public getCardSize(): number {
    return 1 + (this._config?.devices?.length || 4);
  }

  public getGridOptions(): { columns: number | 'full'; min_columns: number; rows: 'auto' } {
    return { columns: 12, min_columns: 6, rows: 'auto' };
  }

  private _rows(): CompareRow[] {
    const hass = this.hass!;
    const c = this._config!;
    const devices = c.devices?.length ? c.devices : snowsureDevices(hass);
    const rows = devices
      .map((device) => compareRow(hass, device, c.days!, this._activeBand))
      .filter((row): row is CompareRow => row !== null);
    return sortRows(rows, c.sort!);
  }

  /** A height switch re-ranks the rows: note where each one was... */
  protected willUpdate(changed: PropertyValues<this>): void {
    this._tops = changed.has('_band' as keyof this) ? this._rowTops() : undefined;
  }

  /** ...and slide every moved row from there to its new place (FLIP). */
  protected updated(): void {
    const before = this._tops;
    this._tops = undefined;
    if (!before?.size || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    for (const [device, top] of this._rowTops()) {
      const li = this.shadowRoot!.querySelector<HTMLElement>(`li[data-device="${CSS.escape(device)}"]`);
      const from = before.get(device);
      if (!li || from === undefined || from === top || typeof li.animate !== 'function') continue;
      li.animate([{ transform: `translateY(${from - top}px)` }, { transform: 'none' }], {
        duration: MOVE_MS,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      });
    }
  }

  private _rowTops(): Map<string, number> {
    const tops = new Map<string, number>();
    this.shadowRoot?.querySelectorAll<HTMLElement>('li[data-device]').forEach((li) => {
      tops.set(li.dataset.device!, li.getBoundingClientRect().top);
    });
    return tops;
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing;
    const hass = this.hass;
    const c = this._config;
    const rows = this._rows();
    const max = Math.max(...rows.map((row) => row.snowfall ?? 0), 5);
    const title = c.title ?? localize(hass, 'compare.title');
    const credits = upstreamCredits(rows.map((row) => resortEntities(hass, row.device).byKey.updated_at));
    return html`
      <ha-card>
        <div class="head">
          <span class="title">${title}</span>
          <span class="secondary"
            >${localize(hass, c.sort === 'snowfall' && c.days === 1 ? 'compare.sort_snowfall_today' : `compare.sort_${c.sort}`, { days: c.days! })}</span
          >
        </div>
        ${this._renderBandSwitch(rows)}
        ${
          rows.length === 0
            ? html`<div class="empty">${localize(hass, 'compare.empty')}</div>`
            : html`<ol class="rows">
                ${repeat(
                  rows,
                  (row) => row.device,
                  (row, index) => this._renderRow(row, index, max),
                )}
              </ol>`
        }
        <div class="footer">
          <a href=${SNOWSURE_URL} target="_blank" rel="noopener noreferrer">${ATTRIBUTION}</a>
          <snowsure-credits .credits=${credits} .label=${localize(hass, 'card.sources')}></snowsure-credits>
        </div>
      </ha-card>
    `;
  }

  /**
   * Valley / mid / summit, like the resort card's switch; heights differ per
   * resort, so no metres. Without a picked band each resort reads its forecast
   * point: that chip is lit when all resorts share it, none when they differ.
   */
  private _renderBandSwitch(rows: CompareRow[]): TemplateResult {
    const hass = this.hass!;
    const points = new Set(rows.map((row) => row.point));
    const active = this._activeBand ?? (points.size === 1 ? [...points][0] : undefined);
    return html`
      <div class="band-switch" role="radiogroup" aria-label=${localize(hass, 'card.snowfall_at')}>
        <span class="band-label"
          ><ha-icon icon="mdi:snowflake"></ha-icon><span>${localize(hass, 'card.snowfall_at')}</span></span
        >
        ${FORECAST_BANDS.map(
          (band) => html`
            <button
              role="radio"
              class="band ${band === active ? 'active' : ''}"
              aria-checked=${band === active ? 'true' : 'false'}
              @click=${() => (this._band = band)}
            >
              ${localize(hass, `card.band.${band}`)}
            </button>
          `,
        )}
      </div>
    `;
  }

  private _renderRow(row: CompareRow, index: number, max: number): TemplateResult {
    const hass = this.hass!;
    const snow = (cm: number) => (row.inches ? cm / CM_PER_INCH : cm);
    const unit = row.inches ? 'in' : 'cm';
    const amount =
      row.snowfall === null
        ? '–'
        : `${formatNumber(snow(row.snowfall), hass, { maximumFractionDigits: row.snowfall < 10 ? 1 : 0 })} ${unit}`;
    // The depth sensor already carries the user's unit.
    const depthUnit = (row.depthEntity?.attributes.unit_of_measurement as string | undefined) ?? 'cm';
    const depth =
      row.depth === null ? null : `${formatNumber(row.depth, hass, { maximumFractionDigits: 0 })} ${depthUnit}`;
    return html`
      <li data-device=${row.device}>
        <button
          class="row"
          @click=${() => row.forecast && fireEvent(this, 'hass-more-info', { entityId: row.forecast.entity_id })}
        >
          <span class="rank">${index + 1}</span>
          <span class="resort">
            <span class="name">${row.name}</span>
            <span class="facts">
              ${
                row.open !== undefined
                  ? html`<span class="status ${row.open ? 'open' : 'closed'}"
                      >${localize(hass, row.open ? 'card.open' : 'card.closed')}</span
                    >`
                  : nothing
              }
              ${depth ? html`<span>${localize(hass, 'card.summit')} ${depth}</span>` : nothing}
              ${row.avalanche !== null ? avalancheIcon(row.avalanche) : nothing}
            </span>
          </span>
          <span class="snow">
            <span class="amount">${amount}</span>
            <span class="track"
              ><span class="bar" style="width: ${Math.round(((row.snowfall ?? 0) / max) * 100)}%"></span
            ></span>
          </span>
          ${
            row.score !== null
              ? html`<span class="score" style="--score-color: ${row.scoreColor || 'var(--primary-color)'}"
                  >${formatNumber(row.score, hass, { maximumFractionDigits: 0 })}</span
                >`
              : html`<span class="score empty"></span>`
          }
        </button>
      </li>
    `;
  }
}

/** Title, resorts, days, height and order; ha-form like the resort card's editor. */
export class SnowsureCompareCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: CompareCardConfig;

  public setConfig(config: CompareCardConfig): void {
    this._config = { ...COMPARE_DEFAULTS, ...config };
  }

  public schema(): Record<string, unknown>[] {
    const hass = this.hass;
    return [
      { name: 'title', selector: { text: {} } },
      { name: 'devices', selector: { device: { multiple: true, filter: [{ integration: 'snowsure' }] } } },
      {
        name: 'sort',
        selector: {
          select: {
            mode: 'dropdown',
            options: COMPARE_SORTS.map((sort) => ({
              value: sort,
              label: localize(hass, `compare.editor.sort_${sort}`),
            })),
          },
        },
      },
      { name: 'days', selector: { number: { min: 1, max: 14, step: 1, mode: 'slider' } } },
      {
        name: 'band',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: 'auto', label: localize(hass, 'editor.band_auto') },
              ...FORECAST_BANDS.map((band) => ({ value: band, label: localize(hass, `card.band.${band}`) })),
            ],
          },
        },
      },
    ];
  }

  private _computeLabel = (item: { name: string }): string => localize(this.hass, `compare.editor.${item.name}`);

  private _valueChanged(ev: CustomEvent<{ value: Partial<CompareCardConfig> }>): void {
    ev.stopPropagation();
    if (!this._config) return;
    const config = { ...this._config, ...ev.detail.value } as CompareCardConfig & Record<string, unknown>;
    if (!config.band || (config.band as string) === 'auto') delete config.band;
    if (!config.title) delete config.title;
    if (!config.devices?.length) delete config.devices;
    if (config.days === COMPARE_DEFAULTS.days) delete config.days;
    if (config.sort === COMPARE_DEFAULTS.sort) delete config.sort;
    this._config = config;
    fireEvent(this, 'config-changed', { config });
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing;
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${{ ...COMPARE_DEFAULTS, ...this._config, band: this._config.band ?? 'auto' }}
        .schema=${this.schema()}
        .computeLabel=${this._computeLabel}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }
}

if (!customElements.get(COMPARE_ELEMENT_NAME)) customElements.define(COMPARE_ELEMENT_NAME, SnowsureCompareCard);
if (!customElements.get(COMPARE_EDITOR_ELEMENT_NAME)) {
  customElements.define(COMPARE_EDITOR_ELEMENT_NAME, SnowsureCompareCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === COMPARE_ELEMENT_NAME)) {
  window.customCards.push({
    type: COMPARE_ELEMENT_NAME,
    name: 'SnowSure Compare',
    description: 'Several SnowSure ski resorts ranked by the new snow of the next days, score or snow depth.',
    documentationURL: 'https://github.com/timmaurice/snowsure',
    preview: true,
  });
}
