import { HomeAssistant } from './types';

import en from './translation/en.json';
import de from './translation/de.json';

/**
 * Keyed by the ISO 639-1 code Home Assistant reports, not by country. A new
 * language has to be imported and added here - a file that is only dropped
 * into translation/ never reaches the bundle.
 */
const translations = { en, de };

interface TranslationObject {
  [key: string]: string | TranslationObject;
}

const typedTranslations: { [key: string]: TranslationObject } = translations;

/** The user's language: `hass.locale` is authoritative, `hass.language` the fallback. */
export function resolveLanguage(hass: HomeAssistant | undefined): string {
  return hass?.locale?.language || hass?.language || 'en';
}

function lookup(language: string, keys: string[]): string | undefined {
  let node: string | TranslationObject | undefined = typedTranslations[language];
  for (const key of keys) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[key];
  }
  return typeof node === 'string' ? node : undefined;
}

/** The translation for `key`, or undefined when no language has it (no key echo). */
export function tryLocalize(hass: HomeAssistant | undefined, key: string): string | undefined {
  const language = resolveLanguage(hass);
  const keys = key.split('.');
  return lookup(language, keys) ?? lookup(language.split('-')[0], keys) ?? lookup('en', keys);
}

export function localize(
  hass: HomeAssistant | undefined,
  key: string,
  placeholders: Record<string, string | number> = {},
): string {
  // "de-CH" falls back to "de" before English.
  const text = tryLocalize(hass, key);
  if (text === undefined) return key;
  return Object.entries(placeholders).reduce(
    (result, [name, value]) => result.replace(`{${name}}`, String(value)),
    text,
  );
}
