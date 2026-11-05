import { TemplateResult, html, svg } from 'lit';
import { StatKey } from './types';

/** Shared silhouette: a small peak, a notch (the valley), a big peak. */
const MOUNTAINS = 'M1 21 7 12.5 10.5 16.5 16 8 23 21Z';

/**
 * Snow-depth icons drawn for this card: the same two mountains with an arrow
 * pointing into the valley, at the flank or at the summit. Kept to two solid
 * shapes so they still read at 20px. 24x24 grid like MDI, so they line up with
 * the ha-icon tiles next to them; colour follows `currentColor`.
 */
const ARROWS: Partial<Record<StatKey, string>> = {
  depth_base: 'M9.5 3.1 9.5 11 7.7 11 10.5 14.6 13.3 11 11.5 11 11.5 3.1Z',
  depth_mid: 'M5.2 12 9.6 12 9.6 13.8 13.2 11 9.6 8.2 9.6 10 5.2 10Z',
  depth_summit: 'M8.24 1.65 11.35 4.76 10.07 6.03 14.6 6.6 14.03 2.07 12.76 3.35 9.65 0.24Z',
};

export function customStatIcon(key: StatKey): TemplateResult | undefined {
  const arrow = ARROWS[key];
  if (!arrow) return undefined;
  return html`<svg class="stat-icon depth-icon" viewBox="0 0 24 24" aria-hidden="true">
    ${svg`<path d=${MOUNTAINS} /><path d=${arrow} />`}
  </svg>`;
}

/** The usual colours of the five European avalanche danger levels. */
export const AVALANCHE_COLORS: Record<number, string> = {
  1: '#ccff66',
  2: '#ffff00',
  3: '#ff9900',
  4: '#ff0000',
  5: '#a00000',
};

/**
 * Avalanche danger as the familiar diamond: a dark mountain with a snow cap
 * above, the level colour and number below; level 5 is chequered red and
 * black; level 0 is the grey "no bulletin" diamond. Drawn here, 48x48.
 */
export function avalancheIcon(level: number): TemplateResult {
  const color = AVALANCHE_COLORS[level] ?? '#bdbdbd';
  const chequered = level >= 5;
  return html`<svg class="avalanche-icon" viewBox="0 0 48 48" aria-hidden="true">
    ${svg`
      <defs>
        <pattern id="avalanche-check" width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill="#e00000" />
          <rect width="2.5" height="2.5" fill="#111" />
          <rect x="2.5" y="2.5" width="2.5" height="2.5" fill="#111" />
        </pattern>
      </defs>
      <path d="M24 2 46 24 2 24Z" fill="#fff" />
      <path d="M3 24 14 14.5 18.5 18 28 8.5 45 24Z" fill="#111" />
      <path d="M24.6 11.9 28 8.5 31.4 11.9 29.4 11.3 28 13 26.6 11.3Z" fill="#fff" />
      <path d="M2 24 46 24 24 46Z" fill=${chequered ? 'url(#avalanche-check)' : color} />
      <path d="M24 2 46 24 24 46 2 24Z" fill="none" stroke="#111" stroke-width="2" stroke-linejoin="round" />
      <text x="24" y="38.5" text-anchor="middle" font-size="14" font-weight="700"
        fill=${chequered ? '#fff' : '#111'}>${level || '–'}</text>
    `}
  </svg>`;
}
