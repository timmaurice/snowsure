import { resolveLanguage } from './localize';
import { HomeAssistant } from './types';

/**
 * Number and date formatting that follows the user's Home Assistant profile:
 * `hass.locale.number_format` decides the separators, not the language alone.
 * Logic always works on raw numbers; only text goes through here.
 */

const NUMBER_FORMAT_LOCALES: Record<string, string | undefined> = {
  comma_decimal: 'en-US', // 1,234.5
  decimal_comma: 'de-DE', // 1.234,5
  space_comma: 'fr-FR', // 1 234,5
  quote_decimal: 'de-CH', // 1'234.5
  system: undefined, // the browser's own
};

export function numberFormatLocale(hass?: HomeAssistant): string | undefined {
  const format = hass?.locale?.number_format;
  if (format === 'none') return 'en-US';
  if (format && format in NUMBER_FORMAT_LOCALES) return NUMBER_FORMAT_LOCALES[format];
  return resolveLanguage(hass);
}

export function formatNumber(value: number, hass?: HomeAssistant, options: Intl.NumberFormatOptions = {}): string {
  if (!Number.isFinite(value)) return '–';
  // 'none' is en-US without grouping, not the raw float.
  const finalOptions = hass?.locale?.number_format === 'none' ? { ...options, useGrouping: false } : options;
  try {
    return new Intl.NumberFormat(numberFormatLocale(hass), finalOptions).format(value);
  } catch {
    return new Intl.NumberFormat('en', finalOptions).format(value);
  }
}

/** A state string as a number, or null. `parseFloat` would read "2026-11-04" as 2026. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Fraction digits for an entity: its display precision, else what the state carries (max 1). */
export function entityDigits(hass: HomeAssistant, entityId: string, state: string): number {
  const precision = hass.entities?.[entityId]?.display_precision;
  if (typeof precision === 'number') return precision;
  const decimals = state.includes('.') ? state.split('.')[1].length : 0;
  return Math.min(decimals, 1);
}

/** A short weekday ("Mo", "Mon") for an ISO date, in the user's language. */
export function formatWeekday(isoDate: string, hass?: HomeAssistant): string {
  // Noon avoids the date shifting by a day in negative UTC offsets.
  const date = new Date(`${isoDate}T12:00:00`);
  if (isNaN(date.getTime())) return isoDate;
  try {
    return new Intl.DateTimeFormat(resolveLanguage(hass), { weekday: 'short' }).format(date);
  } catch {
    return isoDate;
  }
}

export function formatDate(isoDate: string, hass?: HomeAssistant): string {
  const date = new Date(isoDate.length === 10 ? `${isoDate}T12:00:00` : isoDate);
  if (isNaN(date.getTime())) return isoDate;
  try {
    return new Intl.DateTimeFormat(resolveLanguage(hass), {
      day: 'numeric',
      month: 'short',
      ...(isoDate.length > 10 ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(date);
  } catch {
    return isoDate;
  }
}
