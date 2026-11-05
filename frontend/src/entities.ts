import { HassEntity, HomeAssistant } from './types';

export const PLATFORM = 'snowsure';

/**
 * The translation keys the integration gives its entities (sensor.py,
 * binary_sensor.py, image.py). They are the stable handle: entity_ids follow
 * the device name and the user's language, and the user can rename them.
 */
export type SnowsureKey =
  | 'open'
  | 'score'
  | 'depth_base'
  | 'depth_mid'
  | 'depth_summit'
  | 'snowfall_24h'
  | 'snowfall_7d'
  | 'snowfall_season'
  | 'forecast_7d'
  | 'forecast_confidence'
  | 'lifts_open'
  | 'runs_open'
  | 'temperature_base'
  | 'temperature_summit'
  | 'weather'
  | 'snow_quality'
  | 'avalanche_level'
  | 'season_opening'
  | 'updated_at'
  | 'resort_image'
  | 'bluebird';

export interface ResortEntities {
  byKey: Partial<Record<SnowsureKey, HassEntity>>;
  /** Enabled webcam image entities, in SnowSure's order. */
  webcams: HassEntity[];
  /** Enabled trail map image entities, in SnowSure's order. */
  trailMaps: HassEntity[];
}

/** Every SnowSure entity of a device that has a state, by translation key. */
export function resortEntities(hass: HomeAssistant, deviceId: string | undefined): ResortEntities {
  const found: ResortEntities = { byKey: {}, webcams: [], trailMaps: [] };
  if (!deviceId) return found;
  for (const [entityId, entry] of Object.entries(hass.entities ?? {})) {
    if (entry.platform !== PLATFORM || entry.device_id !== deviceId || !entry.translation_key) continue;
    const state = hass.states[entityId];
    if (!state) continue;
    if (entry.translation_key === 'webcam') found.webcams.push(state);
    else if (entry.translation_key === 'trail_map') found.trailMaps.push(state);
    else found.byKey[entry.translation_key as SnowsureKey] = state;
  }
  const position = (entity: HassEntity) => Number(entity.attributes.position ?? 0);
  found.webcams.sort((a, b) => position(a) - position(b));
  found.trailMaps.sort((a, b) => position(a) - position(b));
  return found;
}

/** device_ids that carry SnowSure entities, preferring those of `entityIds`. */
export function snowsureDevices(hass: HomeAssistant | undefined, entityIds: string[] = []): string[] {
  const entries = hass?.entities ?? {};
  const fromHint = entityIds.map((id) => entries[id]).filter((entry) => entry?.platform === PLATFORM);
  const fromRegistry = Object.values(entries).filter((entry) => entry.platform === PLATFORM);
  const devices = [...fromHint, ...fromRegistry]
    .map((entry) => entry?.device_id)
    .filter((id): id is string => Boolean(id));
  return [...new Set(devices)];
}

export function isAvailable(entity: HassEntity | undefined): entity is HassEntity {
  return Boolean(entity) && entity!.state !== 'unavailable' && entity!.state !== 'unknown';
}
