import { ForecastBand, SnowsureCardConfig, StatKey } from './types';

export const ELEMENT_NAME = 'snowsure-card';
export const EDITOR_ELEMENT_NAME = `${ELEMENT_NAME}-editor`;
export const MAX_FORECAST_DAYS = 14;
/** Valley to summit, the order of the band switch. */
export const FORECAST_BANDS: ForecastBand[] = ['base', 'mid', 'summit'];

/** Every tile the stats grid can show, in the order the editor offers them. */
export const STAT_KEYS: StatKey[] = [
  'depth_base',
  'depth_mid',
  'depth_summit',
  'snowfall_24h',
  'snowfall_7d',
  'snowfall_season',
  'forecast_7d',
  'runs_open',
  'lifts_open',
  'temperature_base',
  'temperature_summit',
  'snow_quality',
];

export const DEFAULT_STATS: StatKey[] = [
  'depth_base',
  'depth_summit',
  'snowfall_24h',
  'snowfall_7d',
  'snowfall_season',
  'snow_quality',
  'runs_open',
  'lifts_open',
];

/** What the card assumes when a key is absent. The editor never writes these back. */
export const DEFAULTS = {
  show_score: true,
  show_image: true,
  show_weather: true,
  show_mountain: true,
  show_stats: true,
  show_forecast: true,
  forecast_days: 7,
  show_avalanche: true,
  show_webcams: true,
} satisfies Partial<SnowsureCardConfig>;

const sameStats = (a: unknown, b: StatKey[]) =>
  Array.isArray(a) && a.length === b.length && a.every((key, index) => key === b[index]);

/** Strip every key that only repeats a default, so later default changes still reach the user. */
export function withoutDefaults(config: SnowsureCardConfig): SnowsureCardConfig {
  const cleaned = { ...config } as Record<string, unknown>;
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (cleaned[key] === value) delete cleaned[key];
  }
  if (sameStats(cleaned.stats, DEFAULT_STATS)) delete cleaned.stats;
  if (cleaned.title === '') delete cleaned.title;
  if (cleaned.device === '') delete cleaned.device;
  return cleaned as SnowsureCardConfig;
}
