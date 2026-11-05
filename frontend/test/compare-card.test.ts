import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/snowsure-card';
import {
  CompareCardConfig,
  SnowsureCompareCard,
  SnowsureCompareCardEditor,
  compareRow,
  sortRows,
} from '../src/compare-card';
import { HomeAssistant } from '../src/types';
import { DEVICE, makeHass } from './fixtures';

const OTHER = 'device-whistler';

/** The fixture resort plus a second one with more snow ahead, a lower score and no summit depth. */
function twoResorts(): HomeAssistant {
  const hass = makeHass();
  const copy = (
    from: string,
    key: string,
    change: (attributes: Record<string, unknown>) => Record<string, unknown>,
    state?: string,
  ) => {
    const entityId = from.replace('matterhorn', 'whistler');
    const source = hass.states[from];
    hass.states[entityId] = {
      ...source,
      entity_id: entityId,
      state: state ?? source.state,
      attributes: change({ ...source.attributes }),
    };
    hass.entities[entityId] = { entity_id: entityId, device_id: OTHER, platform: 'snowsure', translation_key: key };
  };
  copy('sensor.matterhorn_forecast', 'forecast_7d', (attributes) => ({
    ...attributes,
    daily: (attributes.daily as Record<string, unknown>[]).map((day, index) => ({
      ...day,
      snowfall_mid: index < 3 ? 10 : 0,
    })),
  }));
  copy('sensor.matterhorn_score', 'score', (attributes) => attributes, '25');
  hass.devices[OTHER] = { id: OTHER, name: 'Whistler Blackcomb' };
  return hass;
}

async function mount(
  config: Partial<CompareCardConfig>,
  hass: HomeAssistant = twoResorts(),
): Promise<SnowsureCompareCard> {
  const card = document.createElement('snowsure-compare-card') as SnowsureCompareCard;
  card.setConfig({ type: 'custom:snowsure-compare-card', ...config });
  document.body.appendChild(card);
  card.hass = hass;
  await card.updateComplete;
  return card;
}

const text = (card: HTMLElement, selector: string) =>
  Array.from(card.shadowRoot!.querySelectorAll(selector)).map((el) => el.textContent?.replace(/\s+/g, ' ').trim());

afterEach(() => {
  document.body.innerHTML = '';
});

describe('compare card', () => {
  it('ranks every SnowSure resort by the new snow of the next days', async () => {
    const card = await mount({});
    expect(text(card, '.name')).toEqual(['Whistler Blackcomb', 'Matterhorn Ski Paradise']);
    // Days 1-3 at each resort's forecast point (mid): 3 × 10 cm and 0.5 + 0 + 6.9 cm.
    expect(text(card, '.amount')).toEqual(['30 cm', '7.4 cm']);
    expect(text(card, '.secondary')).toEqual(['New snow in the next 3 days']);
    expect(text(card, '.score')).toEqual(['25', '33']);
    expect(text(card, '.footer a')).toEqual(['Data by SnowSure.ai']);
  });

  it('sorts by score or summit depth, and keeps resorts without a value last', async () => {
    expect(text(await mount({ sort: 'score' }), '.name')).toEqual(['Matterhorn Ski Paradise', 'Whistler Blackcomb']);
    expect(text(await mount({ sort: 'depth' }), '.name')).toEqual(['Matterhorn Ski Paradise', 'Whistler Blackcomb']);
  });

  it('reads the picked height and limits to the picked resorts', async () => {
    const card = await mount({ band: 'summit', devices: [DEVICE], days: 1 });
    expect(text(card, '.name')).toEqual(['Matterhorn Ski Paradise']);
    expect(text(card, '.amount')).toEqual(['1 cm']);
    expect(text(card, '.secondary')).toEqual(['New snow today · Summit']);
  });

  it('opens the forecast on a row', async () => {
    const card = await mount({});
    const listener = vi.fn();
    card.addEventListener('hass-more-info', listener);
    card.shadowRoot!.querySelector<HTMLButtonElement>('.row')!.click();
    expect(listener.mock.calls[0][0].detail).toEqual({ entityId: 'sensor.whistler_forecast' });
  });

  it('builds rows and orders them', () => {
    const hass = twoResorts();
    const row = compareRow(hass, DEVICE, 3, undefined)!;
    expect(row).toMatchObject({ name: 'Matterhorn Ski Paradise', score: 33, depth: 78, open: true, avalanche: 2 });
    expect(compareRow(hass, 'device-sun', 3, undefined)).toBeNull();
    const rows = [
      { ...row, name: 'B', snowfall: null },
      { ...row, name: 'A', snowfall: null },
      { ...row, name: 'C', snowfall: 2 },
    ];
    expect(sortRows(rows, 'snowfall').map((r) => r.name)).toEqual(['C', 'A', 'B']);
  });

  it('keeps defaults out of the saved config', async () => {
    const editor = document.createElement('snowsure-compare-card-editor') as SnowsureCompareCardEditor;
    editor.setConfig({ type: 'custom:snowsure-compare-card' });
    editor.hass = makeHass();
    document.body.appendChild(editor);
    await editor.updateComplete;
    const listener = vi.fn();
    editor.addEventListener('config-changed', listener);
    editor.shadowRoot!.querySelector('ha-form')!.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { days: 3, sort: 'snowfall', band: 'auto', devices: [] } },
      }),
    );
    expect(listener.mock.calls[0][0].detail.config).toEqual({ type: 'custom:snowsure-compare-card' });
  });
});
