import { test, expect } from './fixtures/hass';
import { demoDevice, useDashboard } from './helpers/homeassistant';

test.describe('The compare card', () => {
  test('ranks the picked resorts by new snow', async ({ page, consoleErrors }) => {
    const device = await demoDevice();
    const urlPath = await useDashboard('compare', {
      views: [{ title: 'Compare', cards: [{ type: 'custom:snowsure-compare-card', devices: [device], days: 1 }] }],
    });

    await page.goto(`/${urlPath}/0`);
    const card = page.locator('snowsure-compare-card');
    await expect(card.locator('.row')).toHaveCount(1, { timeout: 60_000 });
    await expect(card.locator('.name')).toHaveText('Kaiserberg (Demo)');
    // The demo resort's forecast point (mid) gets 25 cm today.
    await expect(card.locator('.amount')).toHaveText(/^25 cm$/);
    await expect(card.locator('.score')).toHaveText('72');
    expect(consoleErrors).toEqual([]);
  });
});
