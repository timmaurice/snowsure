import { LitElement, TemplateResult, html, nothing, unsafeCSS } from 'lit';
import { property, state } from 'lit/decorators.js';
import { HomeAssistant, LovelaceCardEditor, SnowsureCardConfig } from './types';
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
  selector?: Record<string, unknown>;
  schema?: SchemaItem[];
}

export class SnowsureCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: SnowsureCardConfig;

  static styles = unsafeCSS(editorStyles);

  public setConfig(config: SnowsureCardConfig): void {
    this._config = { ...DEFAULTS, stats: DEFAULT_STATS, ...config };
  }

  /** Built per render so the expandable's title follows the user's language. */
  public schema(): SchemaItem[] {
    const hass = this.hass;
    return [
      { name: 'device', selector: { device: { filter: [{ integration: 'snowsure' }] } } },
      { name: 'title', selector: { text: {} } },
      {
        type: 'expandable',
        title: localize(hass, 'editor.display'),
        schema: [
          { name: 'show_score', selector: { boolean: {} } },
          { name: 'show_image', selector: { boolean: {} } },
          { name: 'show_weather', selector: { boolean: {} } },
          { name: 'show_stats', selector: { boolean: {} } },
          {
            name: 'stats',
            selector: {
              select: {
                multiple: true,
                reorder: true,
                mode: 'dropdown',
                options: STAT_KEYS.map((key) => ({ value: key, label: localize(hass, `card.${key}`) })),
              },
            },
          },
          { name: 'show_forecast', selector: { boolean: {} } },
          {
            name: 'forecast_days',
            selector: { number: { min: 1, max: MAX_FORECAST_DAYS, step: 1, mode: 'slider' } },
          },
          {
            name: 'forecast_band',
            selector: {
              select: {
                mode: 'dropdown',
                options: FORECAST_BANDS.map((band) => ({ value: band, label: localize(hass, `card.band.${band}`) })),
              },
            },
          },
          { name: 'show_avalanche', selector: { boolean: {} } },
          { name: 'show_webcams', selector: { boolean: {} } },
        ],
      },
    ];
  }

  private _computeLabel = (item: SchemaItem): string => (item.name ? localize(this.hass, `editor.${item.name}`) : '');

  private _valueChanged(ev: CustomEvent<{ value: Partial<SnowsureCardConfig> }>): void {
    ev.stopPropagation();
    if (!this._config) return;
    this._config = { ...this._config, ...ev.detail.value };
    fireEvent(this, 'config-changed', { config: withoutDefaults(this._config) });
  }

  protected render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing;
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${this.schema()}
        .computeLabel=${this._computeLabel}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }
}

if (!customElements.get(EDITOR_ELEMENT_NAME)) {
  customElements.define(EDITOR_ELEMENT_NAME, SnowsureCardEditor);
}
