import { describe, expect, it } from 'vitest';
import { localize } from '../src/localize';
import { formatNumber, toNumber } from '../src/format';
import { HomeAssistant } from '../src/types';
import en from '../src/translation/en.json';
import de from '../src/translation/de.json';
import cardSource from '../src/snowsure-card.ts?raw';
import editorSource from '../src/editor.ts?raw';

const hass = (language: string, number_format: string = 'language') =>
  ({ language, locale: { language, number_format } }) as unknown as HomeAssistant;

function keys(node: object, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

describe('localize', () => {
  it('has the same keys in every language', () => {
    expect(keys(de).sort()).toEqual(keys(en).sort());
  });

  it.each(['de', 'de-CH'])('%s does not fall back to English', (language) => {
    expect(localize(hass(language), 'card.forecast')).not.toBe(localize(hass('en'), 'card.forecast'));
  });

  it('falls back to English and then to the key', () => {
    expect(localize(hass('xx'), 'card.forecast')).toBe('Snow forecast');
    expect(localize(hass('en'), 'card.nope')).toBe('card.nope');
  });

  it('fills placeholders', () => {
    expect(localize(hass('en'), 'card.avalanche_level', { level: 3 })).toBe('Level 3');
  });
});

describe('format', () => {
  it.each([
    ['comma_decimal', '1,234.5'],
    ['decimal_comma', '1.234,5'],
    ['quote_decimal', "1'234.5"],
    ['none', '1234.5'],
  ])('%s', (format, expected) => {
    expect(formatNumber(1234.5, hass('en', format))).toBe(expected);
  });

  it('does not read a timestamp as a number', () => {
    expect(toNumber('2026-11-04T15:00:00+00:00')).toBeNull();
    expect(toNumber('unknown')).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber('-13.1')).toBe(-13.1);
  });
});

describe('Home Assistant elements', () => {
  // Removed from the frontend; an undefined tag renders as nothing, silently.
  const REMOVED = /<(ha-textfield|ha-fab|ha-radio|ha-circular-progress|mwc-[a-z-]+)[\s>]/;

  it.each([
    ['card', cardSource],
    ['editor', editorSource],
  ])('%s uses no removed element', (_, source) => {
    expect(source).not.toMatch(REMOVED);
  });
});
