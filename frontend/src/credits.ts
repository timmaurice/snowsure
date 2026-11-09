import { TemplateResult, html, nothing } from 'lit';
import { HassEntity } from './types';

export const SNOWSURE_URL = 'https://www.snowsure.ai';

/**
 * SnowSure's terms name this credit word for word, so it stays English in
 * every language.
 */
export const ATTRIBUTION = 'Data by SnowSure.ai';

/** One upstream source SnowSure lists under `credits.upstream` (parser.py). */
export interface UpstreamCredit {
  name: string;
  text: string;
  url?: string | null;
  license?: string | null;
}

/**
 * The upstream sources the integration puts on each resort's `updated_at`
 * sensor, merged across resorts without duplicates. SnowSure's API asks every
 * display of its data to carry them next to its own credit.
 */
export function upstreamCredits(entities: (HassEntity | undefined)[]): UpstreamCredit[] {
  const seen = new Map<string, UpstreamCredit>();
  for (const entity of entities) {
    const sources = entity?.attributes.sources;
    if (!Array.isArray(sources)) continue;
    for (const source of sources as Partial<UpstreamCredit>[]) {
      if (!source || typeof source.text !== 'string' || !source.text) continue;
      const key = source.name || source.text;
      if (!seen.has(key)) seen.set(key, source as UpstreamCredit);
    }
  }
  return [...seen.values()];
}

/** The source list under the footer: text, linked where there is an https URL, and the licence. */
export function renderCredits(credits: UpstreamCredit[]): TemplateResult {
  return html`<ul class="sources">
    ${credits.map(
      (credit) =>
        html`<li>
          ${
            credit.url?.startsWith('https://')
              ? html`<a href=${credit.url} target="_blank" rel="noopener noreferrer">${credit.text}</a>`
              : credit.text
          }${credit.license ? html` <span class="license">(${credit.license})</span>` : nothing}
        </li>`,
    )}
  </ul>`;
}
