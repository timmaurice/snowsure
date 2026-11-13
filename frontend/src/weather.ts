import { tryLocalize } from './localize';
import { HomeAssistant } from './types';

/**
 * SnowSure's weather text ("Slight snowfall") is the reliable field: its WMO
 * code often disagrees (code 0 "clear sky" next to "Slight snowfall", because
 * SnowSure rewrites the text from the snowfall amount). So texts are what gets
 * translated and iconified; unknown texts are shown as they come.
 */
export function weatherKey(text: string | null | undefined): string {
  return (text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function weatherText(hass: HomeAssistant | undefined, text: string | null | undefined): string {
  if (!text) return '';
  return tryLocalize(hass, `card.weather.${weatherKey(text)}`) ?? text;
}

export function weatherIcon(text: string | null | undefined): string {
  const key = weatherKey(text);
  if (key.includes('hail')) return 'mdi:weather-hail';
  if (key.includes('thunder')) return 'mdi:weather-lightning-rainy';
  if (key.includes('freezing')) return 'mdi:weather-snowy-rainy';
  if (key.startsWith('heavy_snow') || key === 'heavy_snowfall') return 'mdi:weather-snowy-heavy';
  if (key.includes('snow')) return 'mdi:weather-snowy';
  if (key.startsWith('heavy') || key.startsWith('violent')) return 'mdi:weather-pouring';
  if (key.includes('rain') || key.includes('drizzle')) return 'mdi:weather-rainy';
  if (key.includes('fog')) return 'mdi:weather-fog';
  if (key === 'overcast') return 'mdi:weather-cloudy';
  if (key === 'clear_sky') return 'mdi:weather-sunny';
  if (key) return 'mdi:weather-partly-cloudy';
  return 'mdi:weather-cloudy-alert';
}

export function snowQualityText(hass: HomeAssistant | undefined, label: string | null | undefined): string {
  if (!label) return '';
  return tryLocalize(hass, `card.snow_quality_values.${weatherKey(label)}`) ?? label;
}

export function ratingText(hass: HomeAssistant | undefined, label: string | null | undefined): string {
  if (!label) return '';
  return tryLocalize(hass, `card.rating_values.${weatherKey(label)}`) ?? label;
}
