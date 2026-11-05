import { TemplateResult, html, nothing, svg } from 'lit';
import { EAWS_ICONS } from './avalanche-icons';
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
 * Avalanche danger as the European diamond (EAWS icons, lawinen.report style):
 * the level colour and number in the lower half, level 5 chequered red and
 * black; level 0 is the "no rating" icon. Height follows the CSS, width the
 * picture (clouds reach out to the right from level 2).
 */
export function avalancheIcon(level: number): TemplateResult {
  const icon = EAWS_ICONS[Math.min(Math.max(level, 0), 4)];
  const [x0, y0, x1, y1] = icon.bottomBox ?? [0, 0, 0, 0];
  const height = y1 - y0;
  const middle = (x0 + x1) / 2;
  const chequered = level >= 5;
  return html`<svg class="avalanche-icon" viewBox=${icon.viewBox} aria-hidden="true">
    ${svg`
      <defs>
        <pattern id="avalanche-check" width="150" height="150" patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)">
          <rect width="150" height="150" fill="#e3000f" />
          <rect width="75" height="75" fill="#000" />
          <rect x="75" y="75" width="75" height="75" fill="#000" />
        </pattern>
      </defs>
      ${
        icon.bottom
          ? svg`
            <path fill="#fff" d=${`M${middle} ${y0 - height}L${x1} ${y0}L${middle} ${y1}L${x0} ${y0}Z`} />
            <path fill=${chequered ? 'url(#avalanche-check)' : (AVALANCHE_COLORS[level] ?? '#fff')} d=${icon.bottom} />
            <text x=${middle} y=${y0 + height * 0.42} text-anchor="middle" dominant-baseline="central"
              font-size=${height * 0.72} font-weight="700" class="avalanche-number ${chequered ? 'inverse' : ''}"
              >${level}</text>`
          : nothing
      }
      ${icon.layers.map((layer) => svg`<path fill=${layer.fill} fill-rule="evenodd" d=${layer.d} />`)}
    `}
  </svg>`;
}
