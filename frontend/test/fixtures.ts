import { HassEntity, HomeAssistant } from '../src/types';

export const DEVICE = 'device-matterhorn';

function entity(entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return { entity_id, state, attributes };
}

const DAILY = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-11-${String(4 + i).padStart(2, '0')}`,
  snowfall: i === 2 ? 6.9 : i === 0 ? 0.5 : 0,
  freezing_level: 2900,
  temp_min: -14.5 - i,
  temp_max: i === 0 ? -12.8 : -12.8 + i,
  conditions: 'Slight snowfall',
  snowfall_base: i === 2 ? 0.4 : 0,
  snowfall_mid: i === 2 ? 6.9 : i === 0 ? 0.5 : 0,
  snowfall_summit: i === 2 ? 12.5 : i === 0 ? 1 : 0,
}));

/** SnowSure entities as the integration creates them, plus unrelated ones like a real instance has. */
export function makeHass(overrides: Partial<HomeAssistant> = {}): HomeAssistant {
  const snowsure: [string, string, HassEntity][] = [
    [
      'binary_sensor.matterhorn_open',
      'open',
      entity('binary_sensor.matterhorn_open', 'on', { trail_map: 'https://maps.example/trail.pdf' }),
    ],
    [
      'sensor.matterhorn_score',
      'score',
      entity('sensor.matterhorn_score', '33', {
        rating: 'Solid',
        rating_color: '#0d9488',
        tagline: 'Adequate snow',
        trend: 'improving',
      }),
    ],
    [
      'sensor.matterhorn_depth_valley',
      'depth_base',
      entity('sensor.matterhorn_depth_valley', '31.0', { unit_of_measurement: 'cm', vs_average_pct: 10 }),
    ],
    [
      'sensor.matterhorn_depth_summit',
      'depth_summit',
      entity('sensor.matterhorn_depth_summit', '78.0', { unit_of_measurement: 'cm' }),
    ],
    [
      'sensor.matterhorn_new_snow_24h',
      'snowfall_24h',
      entity('sensor.matterhorn_new_snow_24h', '1.8', { unit_of_measurement: 'cm' }),
    ],
    [
      'sensor.matterhorn_forecast',
      'forecast_7d',
      entity('sensor.matterhorn_forecast', '15.2', {
        unit_of_measurement: 'cm',
        daily: DAILY,
        horizon_days: 14,
        point_band: 'mid',
        band_elevations: { base: 1562, mid: 2723, summit: 3883 },
        change_24h: 4.2,
        change_48h: -5.1,
      }),
    ],
    ['sensor.matterhorn_lifts', 'lifts_open', entity('sensor.matterhorn_lifts', 'unknown', { total: 37 })],
    [
      'sensor.matterhorn_temp_summit',
      'temperature_summit',
      entity('sensor.matterhorn_temp_summit', '-13.1', { unit_of_measurement: '°C' }),
    ],
    [
      'sensor.matterhorn_avalanche',
      'avalanche_level',
      entity('sensor.matterhorn_avalanche', '2', {
        label: 'Moderate',
        valid_until: '2026-11-04T23:30:00',
        link: 'https://www.slf.ch/',
      }),
    ],
    ['sensor.matterhorn_updated', 'updated_at', entity('sensor.matterhorn_updated', '2026-11-04T15:00:44+00:00')],
    ['sensor.matterhorn_runs', 'runs_open', entity('sensor.matterhorn_runs', '43', { total: 144 })],
    [
      'sensor.matterhorn_temp_valley',
      'temperature_base',
      entity('sensor.matterhorn_temp_valley', '1.3', { unit_of_measurement: '°C' }),
    ],
    ['sensor.matterhorn_weather', 'weather', entity('sensor.matterhorn_weather', 'Slight snowfall')],
    ['sensor.matterhorn_quality', 'snow_quality', entity('sensor.matterhorn_quality', 'icy')],
    ['sensor.matterhorn_season_opening', 'season_opening', entity('sensor.matterhorn_season_opening', '2026-11-28')],
    [
      'sensor.matterhorn_confidence',
      'forecast_confidence',
      entity('sensor.matterhorn_confidence', 'low', { options: ['low', 'medium', 'high'] }),
    ],
    [
      'image.matterhorn_resort_image',
      'resort_image',
      entity('image.matterhorn_resort_image', '2026-11-04T15:00:00+00:00', {
        entity_picture: '/api/image_proxy/image.matterhorn_resort_image?token=t',
      }),
    ],
    [
      'image.matterhorn_webcam_b',
      'webcam',
      entity('image.matterhorn_webcam_b', '2026-11-04T15:00:00+00:00', {
        entity_picture: '/api/image_proxy/image.matterhorn_webcam_b?token=t',
        camera: 'Gornergrat',
        position: 1,
      }),
    ],
    [
      'image.matterhorn_webcam_a',
      'webcam',
      entity('image.matterhorn_webcam_a', '2026-11-04T15:00:00+00:00', {
        entity_picture: '/api/image_proxy/image.matterhorn_webcam_a?token=t',
        camera: 'Glacier Paradise',
        position: 0,
      }),
    ],
    [
      'image.matterhorn_trail_map_cervinia',
      'trail_map',
      entity('image.matterhorn_trail_map_cervinia', '2026-11-04T15:00:00+00:00', {
        entity_picture: '/api/image_proxy/image.matterhorn_trail_map_cervinia?token=t',
        label: 'Breuil-Cervinia',
        pdf_url: null,
        position: 1,
      }),
    ],
    [
      'image.matterhorn_trail_map_zermatt',
      'trail_map',
      entity('image.matterhorn_trail_map_zermatt', '2026-11-04T15:00:00+00:00', {
        entity_picture: '/api/image_proxy/image.matterhorn_trail_map_zermatt?token=t',
        label: 'Zermatt',
        pdf_url: 'https://maps.example/zermatt.pdf',
        position: 0,
      }),
    ],
  ];

  const states: Record<string, HassEntity> = {
    'sun.sun': entity('sun.sun', 'above_horizon'),
    'sensor.sun_next_dawn': entity('sensor.sun_next_dawn', '2026-11-05T06:12:00+00:00'),
  };
  const entities: HomeAssistant['entities'] = {
    'sun.sun': { entity_id: 'sun.sun', platform: 'sun', device_id: 'device-sun' },
    'sensor.sun_next_dawn': {
      entity_id: 'sensor.sun_next_dawn',
      platform: 'sun',
      device_id: 'device-sun',
      translation_key: 'next_dawn',
    },
  };
  // What the registry reports from the integration's suggested_display_precision.
  const precision: Record<string, number> = { depth_base: 0, depth_summit: 0, snowfall_24h: 1, forecast_7d: 1 };
  for (const [id, key, state] of snowsure) {
    states[id] = state;
    entities[id] = {
      entity_id: id,
      platform: 'snowsure',
      device_id: DEVICE,
      translation_key: key,
      ...(key in precision ? { display_precision: precision[key] } : {}),
    };
  }

  return {
    states,
    entities,
    devices: {
      [DEVICE]: {
        id: DEVICE,
        name: 'Matterhorn Ski Paradise',
        configuration_url: 'https://www.snowsure.ai/resorts/matterhorn-ski-paradise',
      },
      'device-sun': { id: 'device-sun', name: 'Sun' },
    },
    language: 'en',
    locale: { language: 'en', number_format: 'language' },
    ...overrides,
  };
}
