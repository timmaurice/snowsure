import { describe, expect, it, vi } from 'vitest';
import '../src/editor';
import type { SnowsureCardEditor } from '../src/editor';
import { SnowsureCardConfig } from '../src/types';
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

it('offers every tile with a translated label', async () => {
  const editor = await mount({});
  const stats = (editor.schema()[2].schema ?? []).find((item) => item.name === 'stats')!;
  const options = (stats.selector!.select as { options: { value: string; label: string }[] }).options;
  expect(options).toHaveLength(12);
  expect(options.every((option) => option.label !== `card.${option.value}`)).toBe(true);
});
