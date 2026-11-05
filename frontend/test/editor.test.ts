import { describe, expect, it, vi } from 'vitest';
import '../src/editor';
import type { SnowsureCardEditor } from '../src/editor';
import { HomeAssistant, SnowsureCardConfig } from '../src/types';
import { DEVICE, makeHass } from './fixtures';

async function mount(config: Partial<SnowsureCardConfig>): Promise<SnowsureCardEditor> {
  const editor = document.createElement('snowsure-card-editor') as SnowsureCardEditor;
  editor.setConfig({ type: 'custom:snowsure-card', ...config });
  editor.hass = makeHass();
  document.body.appendChild(editor);
  await editor.updateComplete;
  return editor;
}

describe('SnowsureCardEditor', () => {
  it('renders an ha-form with the device selector limited to SnowSure', async () => {
    const editor = await mount({ device: DEVICE });
    const form = editor.shadowRoot!.querySelector('ha-form') as unknown as { schema: { selector?: unknown }[] };
    expect(form).not.toBeNull();
    expect(form.schema[0]).toEqual({ name: 'device', selector: { device: { filter: [{ integration: 'snowsure' }] } } });
  });

  it('feeds the form the defaults but never writes them back', async () => {
    const editor = await mount({ device: DEVICE });
    const form = editor.shadowRoot!.querySelector('ha-form') as unknown as { data: SnowsureCardConfig };
    expect(form.data.show_forecast).toBe(true);

    const listener = vi.fn();
    editor.addEventListener('config-changed', listener);
    editor
      .shadowRoot!.querySelector('ha-form')!
      .dispatchEvent(
        new CustomEvent('value-changed', { detail: { value: { ...form.data, forecast_days: 10, title: '' } } }),
      );
    expect(listener.mock.calls[0][0].detail.config).toEqual({
      type: 'custom:snowsure-card',
      device: DEVICE,
      forecast_days: 10,
    });
  });

  it('labels fields in the user language', async () => {
    const editor = await mount({});
    editor.hass = makeHass({ locale: { language: 'de', number_format: 'language' } });
    await editor.updateComplete;
    const form = editor.shadowRoot!.querySelector('ha-form') as unknown as {
      computeLabel: (item: { name: string }) => string;
    };
    expect(form.computeLabel({ name: 'device' })).toBe('Skigebiet');
  });
});

type Mounted = Awaited<ReturnType<typeof mount>>;
const fields = (editor: Mounted) => editor.schema().flatMap((item) => item.schema ?? [item]);
const field = (editor: Mounted, name: string) => fields(editor).find((item) => item.name === name)!;
const options = (editor: Mounted, name: string) =>
  (field(editor, name).selector!.select as { options: { value: string; label: string }[] }).options;

it('offers every tile with a translated label', async () => {
  const editor = await mount({});
  expect(options(editor, 'stats')).toHaveLength(12);
  expect(options(editor, 'stats').every((option) => option.label !== `card.${option.value}`)).toBe(true);
});

it('groups the options by part of the card, in the card order', async () => {
  const editor = await mount({ device: DEVICE });
  const sections = editor.schema().filter((item) => item.type === 'expandable');
  expect(sections.map((item) => item.title)).toEqual([
    'Header, weather and mountain',
    'Tiles',
    'Snow forecast',
    'Webcams',
  ]);
  expect(sections.every((item) => item.icon?.startsWith('mdi:'))).toBe(true);
  expect(sections[2].schema!.map((item) => item.name)).toEqual(['show_forecast', 'forecast_days', 'forecast_band']);
});

it('puts the avalanche switch with the mountain, which shows the level', async () => {
  const names = (editor: Mounted, index: number) =>
    editor
      .schema()
      .filter((item) => item.type === 'expandable')
      [index].schema!.map((item) => item.name);
  const on = await mount({ device: DEVICE });
  expect(names(on, 0)).toEqual(['show_score', 'show_image', 'show_weather', 'show_mountain', 'show_avalanche']);
  expect(names(on, 3)).toEqual(['show_webcams', 'webcams']);

  const off = await mount({ device: DEVICE, show_mountain: false });
  expect(names(off, 0)).not.toContain('show_avalanche');
  expect(names(off, 3)).toEqual(['show_avalanche', 'show_webcams', 'webcams']);
  expect(off.schema()[5].title).toBe('Avalanches and webcams');
});

it('shows section options only while their section is on', async () => {
  const names = (editor: Mounted) => fields(editor).map((item) => item.name);
  const on = await mount({});
  expect(names(on)).toEqual(expect.arrayContaining(['stats', 'forecast_days', 'forecast_band']));

  const off = await mount({ show_forecast: false, show_stats: false });
  expect(names(off)).not.toContain('forecast_days');
  expect(names(off)).not.toContain('forecast_band');
  expect(names(off)).not.toContain('stats');
  expect(names(off)).toContain('show_forecast');
});

describe('forecast options follow the resort', () => {
  const daysMax = (editor: Mounted) => (field(editor, 'forecast_days').selector!.number as { max: number }).max;

  it('limits the days to what the forecast holds', async () => {
    const hass = makeHass();
    const forecast = Object.values(hass.states).find((state) => Array.isArray(state.attributes.daily))!;
    forecast.attributes = { ...forecast.attributes, daily: (forecast.attributes.daily as unknown[]).slice(0, 7) };
    const editor = await mount({ device: DEVICE });
    editor.hass = hass;
    await editor.updateComplete;
    expect(daysMax(editor)).toBe(7);
    expect(daysMax(await mount({}))).toBe(14);
  });

  it('names the heights and offers the automatic forecast point', async () => {
    const editor = await mount({ device: DEVICE });
    expect(options(editor, 'forecast_band')).toEqual([
      { value: 'auto', label: 'Automatic (Mid)' },
      { value: 'base', label: 'Valley · 1,562 m' },
      { value: 'mid', label: 'Mid · 2,723 m' },
      { value: 'summit', label: 'Summit · 3,883 m' },
    ]);
    expect(options(await mount({}), 'forecast_band')[0]).toEqual({
      value: 'auto',
      label: 'Automatic (SnowSure forecast point)',
    });
  });

  it('shows automatic while unset and never writes it', async () => {
    const editor = await mount({ device: DEVICE, forecast_band: 'summit' });
    const form = editor.shadowRoot!.querySelector('ha-form') as unknown as { data: SnowsureCardConfig };
    const listener = vi.fn();
    editor.addEventListener('config-changed', listener);
    editor
      .shadowRoot!.querySelector('ha-form')!
      .dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, forecast_band: 'auto' } } }));
    expect(listener.mock.calls[0][0].detail.config).toEqual({ type: 'custom:snowsure-card', device: DEVICE });
    await editor.updateComplete;
    expect(
      (editor.shadowRoot!.querySelector('ha-form') as unknown as { data: SnowsureCardConfig }).data.forecast_band,
    ).toBe('auto');
  });
});

it('offers the resort webcams by name and drops an empty pick', async () => {
  const editor = await mount({ device: DEVICE });
  expect(options(editor, 'webcams')).toEqual([
    { value: 'image.matterhorn_webcam_a', label: 'Glacier Paradise' },
    { value: 'image.matterhorn_webcam_b', label: 'Gornergrat' },
  ]);
  expect(fields(await mount({ device: DEVICE, show_webcams: false })).map((item) => item.name)).not.toContain(
    'webcams',
  );

  const listener = vi.fn();
  editor.addEventListener('config-changed', listener);
  editor
    .shadowRoot!.querySelector('ha-form')!
    .dispatchEvent(new CustomEvent('value-changed', { detail: { value: { webcams: [] } } }));
  expect(listener.mock.calls[0][0].detail.config).toEqual({ type: 'custom:snowsure-card', device: DEVICE });
});

it('offers the disabled webcams from the registry and enables one when picked', async () => {
  const registry = [
    ['image.matterhorn_webcam_a', 'Webcam Glacier Paradise', null],
    ['image.matterhorn_webcam_b', 'Webcam Gornergrat', null],
    ['image.matterhorn_webcam_c', 'Webcam Rothorn (3104m)', 'integration'],
    ['image.elsewhere_webcam', 'Webcam Elsewhere', null],
  ].map(([entity_id, original_name, disabled_by], index) => ({
    entity_id,
    original_name,
    disabled_by,
    name: null,
    platform: 'snowsure',
    translation_key: 'webcam',
    device_id: index === 3 ? 'device-other' : DEVICE,
  }));
  const callWS = vi.fn(async (message: Record<string, unknown>) =>
    message.type === 'config/entity_registry/list' ? registry : {},
  );
  const editor = document.createElement('snowsure-card-editor') as SnowsureCardEditor;
  editor.setConfig({ type: 'custom:snowsure-card', device: DEVICE });
  editor.hass = { ...makeHass(), callWS } as unknown as HomeAssistant;
  document.body.appendChild(editor);
  await editor.updateComplete;
  await vi.waitFor(() => expect(options(editor, 'webcams')).toHaveLength(3));
  expect(options(editor, 'webcams')).toEqual([
    { value: 'image.matterhorn_webcam_a', label: 'Glacier Paradise' },
    { value: 'image.matterhorn_webcam_b', label: 'Gornergrat' },
    { value: 'image.matterhorn_webcam_c', label: 'Rothorn (3104m) · disabled' },
  ]);

  editor
    .shadowRoot!.querySelector('ha-form')!
    .dispatchEvent(new CustomEvent('value-changed', { detail: { value: { webcams: ['image.matterhorn_webcam_c'] } } }));
  await vi.waitFor(() =>
    expect(callWS).toHaveBeenCalledWith({
      type: 'config/entity_registry/update',
      entity_id: 'image.matterhorn_webcam_c',
      disabled_by: null,
    }),
  );
  await vi.waitFor(() => expect(options(editor, 'webcams')[2].label).toBe('Rothorn (3104m)'));
});
