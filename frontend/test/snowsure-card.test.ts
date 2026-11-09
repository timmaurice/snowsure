import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnowsureCard, statColumns, temperatureColor } from '../src/snowsure-card';
import { HomeAssistant, SnowsureCardConfig } from '../src/types';
import { DEVICE, makeHass } from './fixtures';

const TYPE = 'custom:snowsure-card';

/** Home Assistant's order: create, setConfig, then hass. */
async function mount(config: Partial<SnowsureCardConfig>, hass: HomeAssistant = makeHass()): Promise<SnowsureCard> {
  const card = document.createElement('snowsure-card') as SnowsureCard;
  card.setConfig({ type: TYPE, ...config } as SnowsureCardConfig);
  document.body.appendChild(card);
  card.hass = hass;
  await card.updateComplete;
  return card;
}

const root = (card: SnowsureCard) => card.shadowRoot!;
const text = (card: SnowsureCard, selector: string) =>
  Array.from(root(card).querySelectorAll(selector)).map((el) => el.textContent?.replace(/\s+/g, ' ').trim());

afterEach(() => {
  document.body.innerHTML = '';
});

describe('registration', () => {
  it('defines the element and registers in the picker with a suggestion hook', () => {
    expect(customElements.get('snowsure-card')).toBe(SnowsureCard);
    const entry = window.customCards!.find((card) => card.type === 'snowsure-card');
    expect(entry?.preview).toBe(true);
    expect(entry?.documentationURL).toContain('github.com/timmaurice/snowsure');
    expect(typeof entry?.getEntitySuggestion).toBe('function');
  });

  it('uses rows auto in sections', () => {
    expect(new SnowsureCard().getGridOptions()).toEqual({ columns: 'full', min_columns: 6, rows: 'auto', min_rows: 2 });
  });
});

describe('picker', () => {
  it('stub picks a SnowSure device from a mixed entity list', () => {
    const hass = makeHass();
    expect(SnowsureCard.getStubConfig(hass, ['sun.sun', 'sensor.sun_next_dawn'])).toEqual({ device: DEVICE });
  });

  it('stub without SnowSure entities is still a config setConfig accepts', async () => {
    const hass = makeHass();
    hass.entities = { 'sun.sun': hass.entities['sun.sun'] };
    const stub = SnowsureCard.getStubConfig(hass, ['sun.sun']);
    expect(stub).toEqual({});
    const card = await mount(stub, hass);
    expect(text(card, '.hint')[0]).toContain('Select a SnowSure resort');
  });

  it('suggests only for SnowSure entities, with the stub config', () => {
    const hass = makeHass();
    expect(SnowsureCard.getEntitySuggestion(hass, 'sun.sun')).toBeNull();
    expect(SnowsureCard.getEntitySuggestion(hass, 'sensor.matterhorn_score')).toEqual({
      config: { type: TYPE, ...SnowsureCard.getStubConfig(hass, ['sensor.matterhorn_score']) },
    });
  });
});

describe('setConfig', () => {
  it('does not throw without a device and clamps forecast_days', () => {
    const card = new SnowsureCard();
    expect(() => card.setConfig({ type: TYPE })).not.toThrow();
    card.setConfig({ type: TYPE, forecast_days: 40 });
    expect((card as unknown as { _config: SnowsureCardConfig })._config.forecast_days).toBe(14);
  });

  it('rejects a non-object config', () => {
    expect(() => new SnowsureCard().setConfig(null as unknown as SnowsureCardConfig)).toThrow();
  });
});

describe('render', () => {
  it('shows name, open chip and score', async () => {
    const card = await mount({ device: DEVICE });
    expect(text(card, '.name')).toEqual(['Matterhorn Ski Paradise']);
    expect(text(card, '.chip:not(.bluebird)')).toEqual(['Open']);
    expect(text(card, '.score-value')).toEqual(['33']);
    expect(text(card, '.score-rating')).toEqual(['Solid']);
  });

  it('draws its own depth icons and keeps MDI icons for the other tiles', async () => {
    const card = await mount({
      device: DEVICE,
      show_mountain: false,
      stats: ['depth_base', 'depth_summit', 'runs_open'],
    });
    const tiles = [...root(card).querySelectorAll('.stat')];
    expect(tiles.map((tile) => (tile.querySelector('svg.depth-icon') ? 'svg' : 'ha-icon'))).toEqual([
      'svg',
      'svg',
      'ha-icon',
    ]);
  });

  it('picks tile columns so the rows come out even', async () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map(statColumns)).toEqual([1, 2, 3, 4, 3, 3, 4, 4, 3, 4, 4]);
    const card = await mount({ device: DEVICE, show_mountain: false });
    const stats = root(card).querySelector<HTMLElement>('.stats')!;
    // Six tiles in the fixture (no season or 7-day snowfall entity): 3 + 3.
    expect(stats.style.getPropertyValue('--stat-columns')).toBe('3');
  });

  it('groups the forecast and the webcams for the wide layout', async () => {
    const card = await mount({ device: DEVICE });
    expect(root(card).querySelector('.forecast-block .forecast')).not.toBeNull();
    expect(root(card).querySelector('.webcams-block .webcams')).not.toBeNull();
    const hidden = await mount({ device: DEVICE, show_forecast: false, show_webcams: false });
    expect(root(hidden).querySelector('.forecast-block')).toBeNull();
    expect(root(hidden).querySelector('.webcams-block')).toBeNull();
  });

  it('keeps the same blocks for every resort so cards line up', async () => {
    const hass = makeHass();
    for (const id of Object.keys(hass.entities!)) if (id.includes('webcam')) delete hass.entities![id];
    const card = await mount({ device: DEVICE }, hass);
    expect(text(card, '.webcam-empty')).toEqual(['No webcams']);
  });

  it('renders the default tiles, with open/total for lifts and runs', async () => {
    const card = await mount({ device: DEVICE, show_mountain: false });
    expect(text(card, '.stat-label')).toEqual([
      'Valley',
      'Summit',
      'New snow 24h',
      'Snow quality',
      'Runs open',
      'Lifts open',
    ]);
    expect(text(card, '.stat-value')).toEqual(['31 cm', '78 cm', '1.8 cm', 'Icy', '43 / 144', '– / 37']);
    // snowfall_7d and snowfall_season have no entity in the fixture, so their tiles are skipped rather than shown empty.
  });

  it('shows the configured tiles in the configured order', async () => {
    const card = await mount({ device: DEVICE, stats: ['snow_quality', 'forecast_7d', 'nonsense' as never] });
    expect(text(card, '.stat-label')).toEqual(['Snow quality', 'Forecast 7d']);
    expect(text(card, '.stat-value')).toEqual(['Icy', '15.2 cm']);
  });

  it('puts the depth against the average under the valley tile', async () => {
    const card = await mount({ device: DEVICE, show_mountain: false });
    expect(text(card, '.stat-extra')).toEqual(['10% of avg']);
  });

  it('shows translated weather with valley and summit temperatures', async () => {
    const card = await mount(
      { device: DEVICE, show_mountain: false },
      makeHass({ locale: { language: 'de', number_format: 'language' } }),
    );
    expect(text(card, '.weather-text')).toEqual(['Leichter Schneefall']);
    expect(text(card, '.weather-temps')[0]).toBe('Tal 1° Berg -13°');
    const icon = root(card).querySelector('.weather ha-icon') as unknown as { icon: string };
    expect(icon.icon).toBe('mdi:weather-snowy');
  });

  it('passes unknown weather texts through', async () => {
    const hass = makeHass();
    hass.states['sensor.matterhorn_weather'].state = 'Volcanic ash';
    const card = await mount({ device: DEVICE }, hass);
    expect(text(card, '.weather-text')).toEqual(['Volcanic ash']);
  });

  it('shows the score trend', async () => {
    const card = await mount({ device: DEVICE });
    const trend = root(card).querySelector('.trend') as unknown as { icon: string; className: string };
    expect(trend.icon).toBe('mdi:trending-up');
  });

  it('says when a closed resort opens', async () => {
    const hass = makeHass();
    hass.states['binary_sensor.matterhorn_open'].state = 'off';
    hass.states['sensor.matterhorn_season_opening'].state = '2999-11-28';
    const card = await mount({ device: DEVICE }, hass);
    expect(text(card, '.chip:not(.bluebird)')).toEqual(['Closed']);
    expect(text(card, '.season')[0]).toMatch(/^Season opens /);
  });

  it('does not announce a season start that is in the past', async () => {
    const hass = makeHass();
    hass.states['binary_sensor.matterhorn_open'].state = 'off';
    hass.states['sensor.matterhorn_season_opening'].state = '2000-01-01';
    const card = await mount({ device: DEVICE }, hass);
    expect(root(card).querySelector('.season')).toBeNull();
  });

  it('shows the forecast total and its confidence', async () => {
    const card = await mount({ device: DEVICE, forecast_days: 3 });
    expect(text(card, '.section-title .secondary')[0]).toBe('7.4 cm in 3 days');
    expect(text(card, '.confidence')).toEqual(['Low confidence']);
    const day = root(card).querySelector<HTMLElement>('.day')!;
    expect(day.title).toBe('Slight snowfall · 0° 2,900 m');
  });

  it('shows enabled webcams in SnowSure order through the image proxy', async () => {
    const card = await mount({ device: DEVICE });
    expect(text(card, '.webcam-name')).toEqual(['Glacier ParadiseZermatt Bergbahnen AG', 'Gornergrat']);
    // The image owner SnowSure names stays on the tile.
    expect(text(card, '.webcam-credit')).toEqual(['Zermatt Bergbahnen AG']);
    const img = root(card).querySelector<HTMLImageElement>('.webcam img')!;
    expect(img.getAttribute('src')).toBe('/api/image_proxy/image.matterhorn_webcam_a?token=t');

    const hidden = await mount({ device: DEVICE, show_webcams: false });
    expect(root(hidden).querySelector('.webcams')).toBeNull();
  });

  it('uses the resort image as header background unless turned off', async () => {
    let card = await mount({ device: DEVICE, show_image: false });
    expect(root(card).querySelector('.header.with-image')).toBeNull();
    card = await mount({ device: DEVICE });
    const header = root(card).querySelector<HTMLElement>('.header.with-image')!;
    expect(header.getAttribute('style')).toContain('/api/image_proxy/image.matterhorn_resort_image');
  });

  it('links the trail map next to the attribution', async () => {
    const card = await mount({ device: DEVICE });
    expect(text(card, '.footer a')).toEqual(['Data by SnowSure.ai', 'Trail map']);
  });

  const openTrailMap = async (card: Awaited<ReturnType<typeof mount>>) => {
    const link = [...root(card).querySelectorAll<HTMLAnchorElement>('.footer a')].find(
      (a) => a.textContent === 'Trail map',
    )!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    await card.updateComplete;
    return { link, click, dialog: root(card).querySelector('dialog.trail-map')! };
  };

  it('opens the trail map images in a dialog, one tab per map', async () => {
    const card = await mount({ device: DEVICE });
    expect(root(card).querySelector('dialog')).toBeNull();
    const { link, click, dialog } = await openTrailMap(card);
    expect(link.getAttribute('href')).toBe('https://maps.example/zermatt.pdf');
    expect(click.defaultPrevented).toBe(true);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect([...dialog.querySelectorAll('.map-tab')].map((tab) => tab.textContent?.trim())).toEqual([
      'Zermatt',
      'Breuil-Cervinia',
    ]);
    const img = () => dialog.querySelector('.map-view img')!.getAttribute('src');
    expect(img()).toBe('/api/image_proxy/image.matterhorn_trail_map_zermatt?token=t');
    expect(dialog.querySelector('a.icon-button')!.getAttribute('href')).toBe('https://maps.example/zermatt.pdf');

    dialog.querySelector<HTMLElement>('.map-view')!.click();
    await card.updateComplete;
    expect(dialog.querySelector('.map-view')!.classList.contains('zoomed')).toBe(true);

    dialog.querySelectorAll<HTMLButtonElement>('.map-tab')[1].click();
    await card.updateComplete;
    expect(img()).toBe('/api/image_proxy/image.matterhorn_trail_map_cervinia?token=t');
    expect(dialog.querySelector('.map-view')!.classList.contains('zoomed')).toBe(false);
    // No PDF of its own: the resort's main map is offered instead.
    expect(dialog.querySelector('a.icon-button')!.getAttribute('href')).toBe('https://maps.example/trail.pdf');

    dialog.querySelector<HTMLButtonElement>('button.close')!.click();
    await card.updateComplete;
    expect(root(card).querySelector('dialog')).toBeNull();
  });

  it('falls back to the PDF when there is no trail map image', async () => {
    const hass = makeHass();
    for (const id of Object.keys(hass.entities!)) if (id.includes('trail_map')) delete hass.entities![id];
    const card = await mount({ device: DEVICE }, hass);
    const { dialog } = await openTrailMap(card);
    expect(dialog.querySelector('.map-view')).toBeNull();
    expect(dialog.querySelector('iframe')!.getAttribute('src')).toBe('https://maps.example/trail.pdf');
  });

  it('leaves ctrl/cmd clicks on the trail map to the browser', async () => {
    const card = await mount({ device: DEVICE });
    const link = [...root(card).querySelectorAll<HTMLAnchorElement>('.footer a')].find(
      (a) => a.textContent === 'Trail map',
    )!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
    link.dispatchEvent(click);
    await card.updateComplete;
    expect(click.defaultPrevented).toBe(false);
    expect(root(card).querySelector('dialog')).toBeNull();
  });

  it('formats numbers with the user number format, not the raw state', async () => {
    const hass = makeHass({ locale: { language: 'en', number_format: 'decimal_comma' } });
    const card = await mount({ device: DEVICE }, hass);
    expect(text(card, '.stat-value')).toContain('1,8 cm');
  });

  it('honours the entity display precision', async () => {
    const hass = makeHass();
    hass.entities['sensor.matterhorn_new_snow_24h'].display_precision = 0;
    delete hass.entities['sensor.matterhorn_depth_summit'].display_precision;
    const card = await mount({ device: DEVICE, show_mountain: false }, hass);
    expect(text(card, '.stat-value')).toContain('2 cm');
    // Without a precision the state's own decimals count, at most one.
    expect(text(card, '.stat-value')).toContain('78.0 cm');
  });

  it('draws forecast_days bars, scaled to the biggest day', async () => {
    const card = await mount({ device: DEVICE, forecast_days: 5 });
    const bars = Array.from(root(card).querySelectorAll<HTMLElement>('.bar'));
    expect(bars).toHaveLength(5);
    expect(bars[2].style.height).toBe('100%');
    expect(bars[1].style.height).toBe('0%');
  });

  it('draws max and min temperature lines with a label per day', async () => {
    const card = await mount({ device: DEVICE, forecast_days: 4 });
    expect(text(card, '.temp-label.max')).toEqual(['-13°', '-12°', '-11°', '-10°']);
    expect(text(card, '.temp-label.min')).toEqual(['-15°', '-16°', '-17°', '-18°']);
    const paths = root(card).querySelectorAll('.temp-line');
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute('d')).toMatch(/^M50 [\d.]+ C/);
    // Warmest point at the top of the band, coldest at the bottom.
    const tops = [...root(card).querySelectorAll<HTMLElement>('.temp-dot')].map((dot) => parseFloat(dot.style.top));
    expect(Math.min(...tops)).toBe(22);
    expect(Math.max(...tops)).toBe(78);
  });

  it('colours the temperature lines from cold blue to warm orange', async () => {
    expect(temperatureColor(-30)).toBe('#7c4dff');
    expect(temperatureColor(0)).toBe('#4dd0e1');
    expect(temperatureColor(10)).toBe('#ffa726');
    expect(temperatureColor(40)).toBe('#ef5350');
    expect(temperatureColor(-7)).toBe('#2998fb');
    const card = await mount({ device: DEVICE, forecast_days: 4 });
    const stops = [...root(card).querySelectorAll('#temp-gradient stop')];
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(root(card).querySelector('.temp-line')!.getAttribute('stroke')).toBe('url(#temp-gradient)');
    const dot = root(card).querySelector<HTMLElement>('.temp-dot')!;
    expect(dot.style.getPropertyValue('--temp-color')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('never shows a negative zero', async () => {
    const hass = makeHass();
    const forecast = hass.states['sensor.matterhorn_forecast'];
    const daily = (forecast.attributes.daily as Record<string, unknown>[]).map((day) => ({ ...day }));
    daily[0].temp_max = -0.3;
    forecast.attributes = { ...forecast.attributes, daily };
    const card = await mount({ device: DEVICE, forecast_days: 2 }, hass);
    expect(text(card, '.temp-label.max')[0]).toBe('0°');
  });

  it('switches the snow forecast between valley, mid and summit', async () => {
    const card = await mount({ device: DEVICE, forecast_days: 3 });
    expect(text(card, '.band-name')).toEqual(['Valley', 'Mid', 'Summit']);
    expect(text(card, '.band-height')).toEqual(['1,562 m', '2,723 m', '3,883 m']);
    expect(text(card, '.band.active .band-name')).toEqual(['Mid']);
    expect(text(card, '.section-title .secondary')[0]).toBe('7.4 cm in 3 days');

    root(card).querySelectorAll<HTMLButtonElement>('.band')[2].click();
    await card.updateComplete;
    expect(text(card, '.band.active .band-name')).toEqual(['Summit']);
    expect(text(card, '.amount')).toEqual(['1', '', '13']);
    expect(text(card, '.section-title .secondary')[0]).toBe('13.5 cm in 3 days');
  });

  it('starts on the configured band and drops the switch without band data', async () => {
    const card = await mount({ device: DEVICE, forecast_days: 3, forecast_band: 'base' });
    expect(text(card, '.band.active .band-name')).toEqual(['Valley']);
    expect(text(card, '.amount')).toEqual(['', '', '0.4']);

    const hass = makeHass();
    const forecast = hass.states['sensor.matterhorn_forecast'];
    forecast.attributes = { ...forecast.attributes, band_elevations: undefined };
    const plain = await mount({ device: DEVICE, forecast_days: 3, forecast_band: 'summit' }, hass);
    expect(root(plain).querySelector('.band-switch')).toBeNull();
    expect(text(plain, '.amount')).toEqual(['0.5', '', '7']);
  });

  it('converts the cm/°C forecast attribute only when HA shows imperial units', async () => {
    const hass = makeHass();
    hass.states['sensor.matterhorn_forecast'].attributes.unit_of_measurement = 'in';
    hass.states['sensor.matterhorn_temp_summit'].attributes.unit_of_measurement = '°F';
    const card = await mount({ device: DEVICE, forecast_days: 3 }, hass);
    // 6.9 cm -> 2.7 in, -12.8 °C -> 9 °F
    expect(text(card, '.amount')[2]).toBe('2.7');
    expect(text(card, '.temp-label.max')[0]).toBe('9°');
    expect(text(card, '.section-title .secondary')[0]).toBe('2.9 in in 3 days');
  });

  it('marks an avalanche bulletin whose validity ran out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-04T12:00:00'));
      let card = await mount({ device: DEVICE, show_mountain: false });
      expect(root(card).querySelector('.avalanche.expired')).toBeNull();
      expect(text(card, '.avalanche .secondary')[0]).toMatch(/^valid until/);

      vi.setSystemTime(new Date('2026-11-05T08:00:00'));
      card = await mount({ device: DEVICE, show_mountain: false });
      expect(root(card).querySelector('.avalanche.expired')).not.toBeNull();
      expect(text(card, '.avalanche .secondary')[0]).toMatch(/^expired .*, no newer bulletin yet$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks SnowSure's first forecast day as today, whatever the viewer's clock says", async () => {
    const card = await mount({ device: DEVICE, forecast_days: 3 });
    expect(text(card, '.day.today .weekday')).toEqual(['Today']);
    expect(root(card).querySelectorAll('.day.today')).toHaveLength(1);
  });

  it('draws the temperature curve without overshooting its points', async () => {
    const hass = makeHass();
    const forecast = hass.states['sensor.matterhorn_forecast'];
    const daily = (forecast.attributes.daily as Record<string, unknown>[]).map((day, i) => ({
      ...day,
      temp_max: [0, -10, 0, 0][i] ?? 0,
    }));
    forecast.attributes = { ...forecast.attributes, daily };
    const card = await mount({ device: DEVICE, forecast_days: 4 }, hass);
    const d = root(card).querySelector('.temp-line.max')!.getAttribute('d')!;
    const ys = [...d.matchAll(/[\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    const tops = [...root(card).querySelectorAll<HTMLElement>('.temp-dot.max')].map((dot) => parseFloat(dot.style.top));
    // Every control point stays within the band the dots span.
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(Math.min(...tops) - 0.001);
    expect(Math.max(...ys)).toBeLessThanOrEqual(Math.max(...tops) + 0.001);
  });

  it('shows the avalanche level and hides sections that are switched off', async () => {
    let card = await mount({ device: DEVICE, show_mountain: false });
    expect(text(card, '.level')).toEqual(['2']);
    expect(text(card, '.avalanche-title')).toEqual(['Avalanche danger: Moderate']);

    card = await mount({ device: DEVICE, show_avalanche: false, show_forecast: false, show_stats: false });
    expect(root(card).querySelector('.avalanche')).toBeNull();
    expect(root(card).querySelector('.forecast')).toBeNull();
    expect(root(card).querySelector('.stats')).toBeNull();
  });

  it('says so when there is no bulletin instead of showing level 0', async () => {
    const hass = makeHass();
    hass.states['sensor.matterhorn_avalanche'].state = 'unknown';
    const card = await mount({ device: DEVICE, show_mountain: false }, hass);
    expect(text(card, '.avalanche.none')[0]).toContain('No current avalanche bulletin');
  });

  it('always shows the SnowSure attribution with a link', async () => {
    const card = await mount({ device: DEVICE });
    const link = root(card).querySelector<HTMLAnchorElement>('.footer a')!;
    expect(link.textContent).toBe('Data by SnowSure.ai');
    expect(link.href).toBe('https://www.snowsure.ai/resorts/matterhorn-ski-paradise');
  });

  it('unfolds the upstream sources SnowSure asks to credit', async () => {
    const card = await mount({ device: DEVICE });
    const toggle = root(card).querySelector<HTMLButtonElement>('.sources-toggle')!;
    expect(toggle.textContent!.trim()).toBe('Sources');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(root(card).querySelector('.sources')).toBeNull();

    toggle.click();
    await card.updateComplete;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(text(card, '.sources li')).toEqual([
      'Weather data by Open-Meteo.com (modified by SnowSure) (CC BY 4.0)',
      'JMA forecast data',
    ]);
    const link = root(card).querySelector<HTMLAnchorElement>('.sources a')!;
    expect(link.href).toBe('https://open-meteo.com/');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('has no sources toggle when the integration lists none', async () => {
    const hass = makeHass();
    hass.states['sensor.matterhorn_updated'].attributes = {};
    const card = await mount({ device: DEVICE }, hass);
    expect(root(card).querySelector('.sources-toggle')).toBeNull();
  });

  it('warns for a device without SnowSure entities', async () => {
    const card = await mount({ device: 'device-sun' });
    expect(text(card, '.hint')[0]).toContain('No SnowSure entities');
  });

  it('opens more-info on a stat tile', async () => {
    const card = await mount({ device: DEVICE, show_mountain: false });
    const listener = vi.fn();
    card.addEventListener('hass-more-info', listener);
    root(card).querySelector<HTMLButtonElement>('.stat')!.click();
    expect(listener.mock.calls[0][0].detail).toEqual({ entityId: 'sensor.matterhorn_depth_valley' });
  });

  it('renders German texts from hass.locale', async () => {
    const card = await mount(
      { device: DEVICE, show_mountain: false },
      makeHass({ locale: { language: 'de', number_format: 'language' } }),
    );
    expect(text(card, '.chip:not(.bluebird)')).toEqual(['Geöffnet']);
    // SnowSure's terms name the credit word for word, so it stays English.
    expect(text(card, '.footer a')[0]).toBe('Data by SnowSure.ai');
    expect(text(card, '.sources-toggle')).toEqual(['Quellen']);
    // EAWS name from the card's translation, not SnowSure's English label.
    expect(text(card, '.avalanche-title')).toEqual(['Lawinengefahr: Mäßig']);
    expect(text(card, '.stat-label')).toContain('Pisten offen');
  });
});

describe('mountain', () => {
  it('shows depth, temperature and height at valley and summit, and the 0 °C line', async () => {
    const card = await mount({ device: DEVICE });
    expect(text(card, '.mountain-label.summit')).toEqual(['Summit · 3,883 m 78 cm -13°']);
    expect(text(card, '.mountain-label.valley')).toEqual(['Valley · 1,562 m 31 cm 1° 10% of avg']);
    expect(text(card, '.freezing-label')).toEqual(['0 °C · 1,770 m']);
    expect(root(card).querySelector('.freezing-line')).not.toBeNull();
    expect(root(card).querySelector('.mountain-snow')).not.toBeNull();
  });

  it('takes the depths and temperatures out of the tiles and the weather row', async () => {
    const card = await mount({ device: DEVICE });
    expect(text(card, '.stat-label')).not.toContain('Valley');
    expect(text(card, '.stat-label')).not.toContain('Summit');
    expect(text(card, '.weather-temps')).toEqual(['']);

    const off = await mount({ device: DEVICE, show_mountain: false });
    expect(root(off).querySelector('.mountain')).toBeNull();
    expect(text(off, '.stat-label')).toContain('Valley');
  });

  it('says when the whole mountain is above freezing, and leaves out unknown depths', async () => {
    const hass = makeHass();
    hass.states['sensor.matterhorn_temp_valley'].state = '10.4';
    hass.states['sensor.matterhorn_temp_summit'].state = '6';
    hass.states['sensor.matterhorn_depth_valley'].state = 'unknown';
    hass.states['sensor.matterhorn_depth_summit'].state = 'unknown';
    const card = await mount({ device: DEVICE }, hass);
    expect(text(card, '.freezing-label')).toEqual(['0 °C above the summit']);
    expect(root(card).querySelector('.freezing-line')).toBeNull();
    expect(root(card).querySelector('.mountain-snow')).toBeNull();
    expect(text(card, '.mountain-label.summit')).toEqual(['Summit · 3,883 m 6°']);
  });

  it('keeps the tiles when the heights are unknown', async () => {
    const hass = makeHass();
    const forecast = Object.values(hass.states).find((state) => state.attributes.band_elevations)!;
    forecast.attributes = { ...forecast.attributes, band_elevations: {} };
    const card = await mount({ device: DEVICE }, hass);
    expect(root(card).querySelector('.mountain')).toBeNull();
    expect(text(card, '.stat-label')).toContain('Valley');
  });

  it('carries the avalanche level as a diamond instead of the row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-04T12:00:00'));
      const card = await mount({ device: DEVICE });
      expect(root(card).querySelector('.avalanche')).toBeNull();
      expect(text(card, '.mountain-avalanche')).toEqual(['2 Moderate']);
      expect(root(card).querySelector('.mountain-avalanche')!.getAttribute('title')).toMatch(
        /^Avalanche danger: Moderate · valid until/,
      );

      vi.setSystemTime(new Date('2026-11-05T08:00:00'));
      const old = await mount({ device: DEVICE });
      expect(root(old).querySelector('.mountain-avalanche.expired')).not.toBeNull();
      expect(text(old, '.mountain-avalanche-label')).toEqual(['old report']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a grey diamond without a bulletin, and none when avalanches are off', async () => {
    const hass = makeHass();
    hass.states['sensor.matterhorn_avalanche'].state = 'unknown';
    const card = await mount({ device: DEVICE }, hass);
    expect(text(card, '.mountain-avalanche.none')).toEqual(['no report']);
    const off = await mount({ device: DEVICE, show_avalanche: false });
    expect(root(off).querySelector('.mountain-avalanche')).toBeNull();
  });

  it('shows a tapped forecast day on the mountain and goes back on a second tap', async () => {
    const card = await mount({ device: DEVICE });
    const listener = vi.fn();
    card.addEventListener('hass-more-info', listener);
    const dayCell = () => root(card).querySelector<HTMLElement>('.day[data-index="2"] .bar-track')!;

    dayCell().click();
    await card.updateComplete;
    expect(listener).not.toHaveBeenCalled();
    expect(root(card).querySelector('.day.picked')?.getAttribute('data-index')).toBe('2');
    expect(root(card).querySelector('.mountain-avalanche')).toBeNull();
    expect(text(card, '.mountain-day-date')[0]).toBe('Fri');
    expect(text(card, '.mountain-day-sub')[0]).toBe('Nov 6');
    expect(text(card, '.mountain-label.summit')).toEqual(['Summit · 3,883 m +13 cm']);
    expect(text(card, '.mountain-label.mid')).toEqual(['Mid · 2,723 m +7 cm']);
    expect(text(card, '.mountain-label.valley')).toEqual(['Valley · 1,562 m +0.4 cm']);
    // SnowSure's freezing level for that day, not the one from today's readings.
    expect(text(card, '.freezing-label')).toEqual(['0 °C · 2,900 m']);
    // Not caught by the forecast grid's .forecast rule.
    expect(root(card).querySelector('.freezing-label.forecast')).toBeNull();

    dayCell().click();
    await card.updateComplete;
    expect(root(card).querySelector('.mountain-day')).toBeNull();
    expect(text(card, '.mountain-label.summit')).toEqual(['Summit · 3,883 m 78 cm -13°']);

    dayCell().click();
    await card.updateComplete;
    root(card).querySelector<HTMLButtonElement>('.mountain-day')!.click();
    await card.updateComplete;
    expect(root(card).querySelector('.day.picked')).toBeNull();
  });

  it('keeps the forecast opening more-info without the mountain', async () => {
    const card = await mount({ device: DEVICE, show_mountain: false });
    const listener = vi.fn();
    card.addEventListener('hass-more-info', listener);
    root(card).querySelector<HTMLElement>('.day[data-index="2"] .bar-track')!.click();
    expect(listener.mock.calls[0][0].detail).toEqual({ entityId: 'sensor.matterhorn_forecast' });
  });

  it('shows how the forecast moved since yesterday', async () => {
    const card = await mount({ device: DEVICE });
    const chip = root(card).querySelector('.forecast-trend')!;
    expect(chip.classList.contains('up')).toBe(true);
    expect(chip.textContent?.trim()).toBe('4.2 cm');
    expect(chip.getAttribute('title')).toBe('7-day forecast: 4.2 cm more than yesterday');

    const hass = makeHass();
    hass.states['sensor.matterhorn_forecast'].attributes.change_24h = -0.3;
    expect(root(await mount({ device: DEVICE }, hass)).querySelector('.forecast-trend')).toBeNull();
    hass.states['sensor.matterhorn_forecast'].attributes.change_24h = -6;
    expect(root(await mount({ device: DEVICE }, hass)).querySelector('.forecast-trend.down')).not.toBeNull();
  });

  it('shows header, mountain and credit only when compact', async () => {
    const card = await mount({ device: DEVICE, compact: true, show_mountain: false });
    expect(root(card).querySelector('ha-card.compact')).not.toBeNull();
    expect(root(card).querySelector('.mountain')).not.toBeNull();
    for (const selector of ['.weather', '.stats', '.forecast', '.avalanche', '.webcams']) {
      expect(root(card).querySelector(selector)).toBeNull();
    }
    expect(text(card, '.footer a')[0]).toBe('Data by SnowSure.ai');
    expect(card.getCardSize()).toBe(5);

    // Without heights for the mountain the tiles stand in.
    const hass = makeHass();
    const forecast = Object.values(hass.states).find((state) => state.attributes.band_elevations)!;
    forecast.attributes = { ...forecast.attributes, band_elevations: {} };
    const flat = await mount({ device: DEVICE, compact: true }, hass);
    expect(root(flat).querySelector('.mountain')).toBeNull();
    expect(root(flat).querySelector('.stats')).not.toBeNull();
  });

  it('shows Kaiserwetter in the forecast, the header and the picked day', async () => {
    const card = await mount({ device: DEVICE });
    // Nov 5 (index 1) and Nov 7 (index 3) are Kaiserwetter days.
    const bluebird = [...root(card).querySelectorAll('.day.bluebird')].map((day) => day.getAttribute('data-index'));
    expect(bluebird).toEqual(['1', '3']);
    expect(root(card).querySelector('.day.bluebird')!.getAttribute('title')).toMatch(
      /^Bluebird day after 1 cm new snow · /,
    );
    // Nov 5 is the forecast's second day: tomorrow.
    expect(text(card, '.chip.bluebird')).toEqual(['Bluebird tomorrow']);

    root(card).querySelector<HTMLElement>('.day[data-index="3"] .bar-track')!.click();
    await card.updateComplete;
    expect(root(card).querySelector('.mountain.bluebird')).not.toBeNull();
    expect(text(card, '.mountain-day-bluebird')).toEqual(['Bluebird day']);

    root(card).querySelector<HTMLElement>('.day[data-index="2"] .bar-track')!.click();
    await card.updateComplete;
    expect(root(card).querySelector('.mountain.bluebird')).toBeNull();
  });

  it('shows no Kaiserwetter without the sensor', async () => {
    const hass = makeHass();
    hass.states['binary_sensor.matterhorn_bluebird'].attributes = {};
    const card = await mount({ device: DEVICE }, hass);
    expect(root(card).querySelector('.day.bluebird')).toBeNull();
    expect(root(card).querySelector('.chip.bluebird')).toBeNull();
  });
});
