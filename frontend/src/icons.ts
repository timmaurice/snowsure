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
