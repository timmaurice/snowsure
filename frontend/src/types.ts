export interface LovelaceGridOptions {
  columns?: number | 'full';
  min_columns?: number;
  max_columns?: number;
  rows?: number | 'auto';
  min_rows?: number;
  max_rows?: number;
}

export interface HassDevice {
  id: string;
  name: string | null;
  name_by_user?: string | null;
  configuration_url?: string | null;
}

export interface FrontendLocaleData {
  language: string;
  number_format: 'comma_decimal' | 'decimal_comma' | 'space_comma' | 'quote_decimal' | 'system' | 'language' | 'none';
  time_format?: '12' | '24' | 'system' | 'am_pm' | 'language';
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    unit_of_measurement?: string;
    [key: string]: unknown;
  };
  last_changed?: string;
  last_updated?: string;
}

export interface HassEntityRegistryDisplayEntry {
  entity_id: string;
  device_id?: string;
  platform?: string;
  translation_key?: string;
  display_precision?: number;
  hidden?: boolean;
}

export interface HomeAssistant {
  states: { [entity_id: string]: HassEntity };
  entities: { [entity_id: string]: HassEntityRegistryDisplayEntry };
  devices: { [deviceId: string]: HassDevice };
  language: string;
  locale?: FrontendLocaleData;
  localize?: (key: string, ...args: unknown[]) => string;
}

export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

export interface LovelaceCard extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: LovelaceCardConfig): void;
  getCardSize?(): number | Promise<number>;
}

export interface LovelaceCardEditor extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: LovelaceCardConfig): void;
}

export type StatKey =
  | 'depth_base'
  | 'depth_mid'
  | 'depth_summit'
  | 'snowfall_24h'
  | 'snowfall_7d'
  | 'snowfall_season'
  | 'forecast_7d'
  | 'runs_open'
  | 'lifts_open'
  | 'temperature_base'
  | 'temperature_summit'
  | 'snow_quality';

export interface SnowsureCardConfig extends LovelaceCardConfig {
  /** device_id of a SnowSure resort. */
  device?: string;
  title?: string;
  show_score?: boolean;
  show_image?: boolean;
  show_weather?: boolean;
  show_stats?: boolean;
  /** Tiles in the stats grid, in this order. */
  stats?: StatKey[];
  show_forecast?: boolean;
  forecast_days?: number;
  /** Past days (SnowSure's modelled snowfall) left of today in the forecast chart. */
  history_days?: number;
  /** Elevation the snow forecast starts on; unset is SnowSure's own forecast point (usually mid). */
  forecast_band?: ForecastBand;
  show_avalanche?: boolean;
  show_webcams?: boolean;
}

export type ForecastBand = 'base' | 'mid' | 'summit';

/** One day of the `daily` attribute of the forecast sensor (cm and °C, always). */
export interface ForecastDay {
  date: string;
  snowfall: number | null;
  snowfall_low?: number | null;
  snowfall_high?: number | null;
  snowfall_base?: number | null;
  snowfall_mid?: number | null;
  snowfall_summit?: number | null;
  temp_min?: number | null;
  temp_max?: number | null;
  precipitation_probability?: number | null;
  weather_code?: number | null;
  conditions?: string | null;
  freezing_level?: number | null;
}
