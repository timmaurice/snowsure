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

/** One line per source with its licence: the ⓘ button's tooltip. */
export function creditsTooltip(credits: UpstreamCredit[]): string {
  return credits.map((credit) => (credit.license ? `${credit.text} (${credit.license})` : credit.text)).join('\n');
}

/**
 * The ⓘ next to SnowSure's credit. Hovering shows every source as a tooltip;
 * a tap (touch screens have no hover) unfolds them under the footer.
 */
export function renderCreditsButton(
  credits: UpstreamCredit[],
  label: string,
  expanded: boolean,
  toggle: () => void,
): TemplateResult | typeof nothing {
  if (!credits.length) return nothing;
  return html`<button
    class="sources-toggle"
    title=${creditsTooltip(credits)}
    aria-label=${label}
    aria-expanded=${expanded ? 'true' : 'false'}
    @click=${toggle}
  >
    <ha-icon icon="mdi:information-outline"></ha-icon>
  </button>`;
}

/** The unfolded sources: one small paragraph, linked where there is an https URL, licence in the tooltip. */
export function renderCredits(credits: UpstreamCredit[]): TemplateResult {
  return html`<p class="sources">
    ${credits.map(
      (credit, index) =>
        html`${index ? ' · ' : nothing}${
          credit.url?.startsWith('https://')
            ? html`<a href=${credit.url} target="_blank" rel="noopener noreferrer" title=${credit.license ?? nothing}
                >${credit.text}</a
              >`
            : html`<span title=${credit.license ?? nothing}>${credit.text}</span>`
        }`,
    )}
  </p>`;
}
