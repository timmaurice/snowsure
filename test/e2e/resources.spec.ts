import { test, expect } from './fixtures/hass';
import { resources, useDashboard } from './helpers/homeassistant';

const CARD_PREFIX = '/snowsure_frontend/';

/** Room for a late write to the resource store to show up. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5_000));

test.describe('Lovelace resource registration', () => {
  test('has exactly one resource for the bundled card', async () => {
    // A registration that appended a resource on every restart would only show in the persisted store.
    await settle();
    const ours = (await resources()).filter((resource) => resource.url.startsWith(CARD_PREFIX));
    expect(ours).toHaveLength(1);
    expect(ours[0].url).toMatch(/^\/snowsure_frontend\/snowsure-card\.js\?v=/);
  });

  test('serves the bundle and defines both cards and their editors', async ({ page, consoleErrors }) => {
    const urlPath = await useDashboard('resources', { views: [{ title: 'Empty', cards: [] }] });
    await page.goto(`/${urlPath}/0`);
    await page.waitForFunction(() => customElements.get('snowsure-card') !== undefined, { timeout: 60_000 });

    // The editor is a dynamic import: ask for it the way the UI editor does.
    const editorTag = await page.evaluate(async () => {
      const card = customElements.get('snowsure-card') as unknown as { getConfigElement(): Promise<HTMLElement> };
      return (await card.getConfigElement()).tagName.toLowerCase();
    });
    expect(editorTag).toBe('snowsure-card-editor');
    expect(await page.evaluate(() => !!customElements.get('snowsure-compare-card'))).toBe(true);
    expect(await page.evaluate(() => !!customElements.get('snowsure-compare-card-editor'))).toBe(true);

    const picker = await page.evaluate(() =>
      ((window as unknown as { customCards?: { type: string }[] }).customCards ?? []).map((card) => card.type),
    );
    expect(picker).toEqual(expect.arrayContaining(['snowsure-card', 'snowsure-compare-card']));
    expect(consoleErrors.filter((text) => /has already been used/i.test(text))).toEqual([]);
  });
});
