/**
 * Geometry of the mountain picture. Everything is in percent of the box, so
 * the SVG can stretch with `preserveAspectRatio="none"` while the HTML labels
 * sit at the same percentages without distortion.
 */

/** Height in the box of the summit and the valley floor. */
export const PEAK_Y = 18;
export const VALLEY_Y = 86;
export const PEAK_X = 60;
export const VALLEY_X = 22;

type Point = [number, number];

/** Left skyline of the main mountain, valley to summit. */
const LEFT_RIDGE: Point[] = [
  [VALLEY_X, VALLEY_Y],
  [28, 82],
  [33, 76],
  [37, 77],
  [42, 66],
  [46, 63],
  [50, 54],
  [53, 50],
  [56, 36],
  [PEAK_X, PEAK_Y],
];

/** Right skyline, summit down to the right edge. */
const RIGHT_RIDGE: Point[] = [
  [PEAK_X, PEAK_Y],
  [63, 26],
  [65, 25],
  [69, 36],
  [73, 44],
  [76, 42],
  [82, 55],
  [90, 62],
  [100, 66],
];

const path = (points: Point[]) => points.map(([x, y]) => `${x},${y}`).join(' L');

export const MOUNTAIN_PATH = `M0,100 L0,${VALLEY_Y + 1} L${path([...LEFT_RIDGE, ...RIGHT_RIDGE.slice(1)])} L100,100 Z`;

/** The face turned away from the light: from the summit down the right side. */
export const SHADOW_PATH = `M${PEAK_X},${PEAK_Y} L${path(RIGHT_RIDGE.slice(1))} L100,100 L47,100 L51,82 L54,64 L58,40 Z`;

/** A paler range behind, never higher than the main summit. */
export const BACK_RANGE_PATH =
  'M0,100 L0,66 L9,58 L15,62 L24,50 L33,60 L40,56 L48,62 L60,48 L70,38 L77,44 L86,32 L93,38 L100,34 L100,100 Z';

/** Snow from the top of the box down to `y`, with a ragged lower edge. */
export function snowPath(y: number): string {
  const edge = [0, 2, -1.5, 2.5, -1, 1.5, -2, 2, 0, 1.5, -1];
  const step = 100 / (edge.length - 1);
  const points = edge.map((offset, index) => `${(index * step).toFixed(1)},${(y + offset).toFixed(1)}`);
  return `M0,0 L100,0 L${points.reverse().join(' L')} Z`;
}

/** Height in the box for an elevation between the valley and the summit (clamped). */
export function elevationY(elevation: number, valley: number, summit: number): number {
  const share = (elevation - valley) / (summit - valley);
  return VALLEY_Y - Math.min(Math.max(share, 0), 1) * (VALLEY_Y - PEAK_Y);
}

/** Where the left skyline crosses height `y`, for a marker on the slope. */
export function ridgeX(y: number): number {
  for (let i = LEFT_RIDGE.length - 1; i > 0; i--) {
    const [x1, y1] = LEFT_RIDGE[i];
    const [x0, y0] = LEFT_RIDGE[i - 1];
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) {
      return y0 === y1 ? x0 : x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
    }
  }
  return y >= VALLEY_Y ? VALLEY_X : PEAK_X;
}

export type FreezingLevel =
  | { kind: 'between'; elevation: number }
  | { kind: 'below' }
  | { kind: 'above' }
  | { kind: 'forecast'; elevation: number };

/**
 * The 0 °C line. From the valley and summit temperatures the card shows (so
 * the line agrees with them), linear in between; SnowSure's daily freezing
 * level only when a temperature is missing — it is a day value and often
 * disagrees with the current readings.
 */
export function freezingLevel(
  valley: { elevation: number; celsius: number | null },
  summit: { elevation: number; celsius: number | null },
  forecastMetres: number | null,
): FreezingLevel | null {
  const { celsius: low } = valley;
  const { celsius: high } = summit;
  if (low === null || high === null) {
    return forecastMetres === null ? null : { kind: 'forecast', elevation: forecastMetres };
  }
  if (low <= 0 && high <= 0) return { kind: 'below' };
  if (low >= 0 && high >= 0) return { kind: 'above' };
  const share = low / (low - high);
  const elevation = valley.elevation + share * (summit.elevation - valley.elevation);
  return { kind: 'between', elevation: Math.round(elevation / 10) * 10 };
}
