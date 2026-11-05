import { test, expect } from './fixtures/hass';
import { demoDevice, useDashboard } from './helpers/homeassistant';

let urlPath: string;

test.beforeAll(async () => {
  const device = await demoDevice();
  urlPath = await useDashboard('card', {
    views: [
      {
        title: 'Resort',
        type: 'sections',
        sections: [
          { type: 'grid', column_span: 2, cards: [{ type: 'custom:snowsure-card', device }] },
          { type: 'grid', cards: [{ type: 'custom:snowsure-card', device, compact: true }] },
        ],
      },
      { title: 'Elsewhere', cards: [{ type: 'markdown', content: 'nothing here' }] },
    ],
  });
});

test.describe('The resort card on a real dashboard', () => {
  test('paints the demo resort with its mountain, tiles and forecast', async ({ page, consoleErrors }) => {
    await page.goto(`/${urlPath}/0`);
    // Assert on what the card paints, not on the custom element: the host has no box of its own.
    const card = page.locator('snowsure-card').first();
    await expect(card.locator('ha-card')).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('.name')).toHaveText('Kaiserberg (Demo)');
    await expect(card.locator('.mountain')).toBeVisible();
    await expect(card.locator('.mountain-label.summit')).toContainText('85');
    // The EAWS diamond carries the level as its number.
    await expect(card.locator('.mountain-avalanche .avalanche-number')).toHaveText('4');
    await expect(card.locator('.stat')).toHaveCount(6);
    await expect(card.locator('.forecast .day')).toHaveCount(7);
    await expect(card.locator('.forecast-trend.up')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('shows Kaiserwetter tomorrow and on the mountain when the day is picked', async ({ page }) => {
    await page.goto(`/${urlPath}/0`);
    const card = page.locator('snowsure-card').first();
    await expect(card.locator('.chip.bluebird')).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('.forecast .day.bluebird')).toHaveCount(2);

    await card.locator('.day[data-index="1"] .bar-track').click();
    await expect(card.locator('.mountain.bluebird')).toBeVisible();
    await expect(card.locator('.mountain-day-bluebird')).toBeVisible();

    // A second tap goes back to now.
    await card.locator('.day[data-index="1"] .bar-track').click();
    await expect(card.locator('.mountain-day')).toHaveCount(0);
    await expect(card.locator('.mountain-avalanche')).toBeVisible();
  });

  test('keeps the compact card to header, mountain and credit', async ({ page }) => {
    await page.goto(`/${urlPath}/0`);
    const compact = page.locator('snowsure-card').nth(1);
    await expect(compact.locator('ha-card.compact')).toBeVisible({ timeout: 60_000 });
    await expect(compact.locator('.mountain')).toBeVisible();
    await expect(compact.locator('.forecast')).toHaveCount(0);
    await expect(compact.locator('.footer a').first()).toHaveAttribute('href', /snowsure\.ai/);
  });

  test('comes back after leaving the view and returning', async ({ page }) => {
    // Views are torn out of the DOM on a switch; a card that misses being shown again comes back empty.
    await page.goto(`/${urlPath}/0`);
    const name = page.locator('snowsure-card').first().locator('.name');
    await expect(name).toHaveText('Kaiserberg (Demo)', { timeout: 60_000 });

    await page.getByRole('tab', { name: 'Elsewhere' }).click();
    await expect(page.locator('snowsure-card')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Resort' }).click();
    await expect(name).toHaveText('Kaiserberg (Demo)', { timeout: 30_000 });
  });
});
