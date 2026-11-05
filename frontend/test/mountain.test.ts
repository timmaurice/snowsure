import { describe, expect, it } from 'vitest';
import { PEAK_X, PEAK_Y, VALLEY_X, VALLEY_Y, elevationY, freezingLevel, ridgeX } from '../src/mountain';

describe('freezingLevel', () => {
  const valley = (celsius: number | null) => ({ elevation: 1562, celsius });
  const summit = (celsius: number | null) => ({ elevation: 3883, celsius });

  it('puts 0 °C between the two readings, to 10 m', () => {
    expect(freezingLevel(valley(1.3), summit(-13.1), 3200)).toEqual({ kind: 'between', elevation: 1770 });
  });

  it('also handles an inversion', () => {
    expect(freezingLevel(valley(-2), summit(2), null)).toEqual({ kind: 'between', elevation: 2720 });
  });

  it('says below the valley or above the summit when both agree', () => {
    expect(freezingLevel(valley(-5.6), summit(-8.9), 3720)).toEqual({ kind: 'below' });
    expect(freezingLevel(valley(10.4), summit(6), null)).toEqual({ kind: 'above' });
  });

  it("falls back to SnowSure's daily freezing level without a temperature", () => {
    expect(freezingLevel(valley(null), summit(-8), 3200)).toEqual({ kind: 'forecast', elevation: 3200 });
    expect(freezingLevel(valley(null), summit(null), null)).toBeNull();
  });
});

describe('geometry', () => {
  it('maps the valley and the summit to the picture and clamps the rest', () => {
    expect(elevationY(1562, 1562, 3883)).toBe(VALLEY_Y);
    expect(elevationY(3883, 1562, 3883)).toBe(PEAK_Y);
    expect(elevationY(5000, 1562, 3883)).toBe(PEAK_Y);
    expect(elevationY(100, 1562, 3883)).toBe(VALLEY_Y);
  });

  it('finds the slope between valley and summit', () => {
    expect(ridgeX(PEAK_Y)).toBe(PEAK_X);
    expect(ridgeX(VALLEY_Y)).toBe(VALLEY_X);
    const middle = ridgeX((PEAK_Y + VALLEY_Y) / 2);
    expect(middle).toBeGreaterThan(VALLEY_X);
    expect(middle).toBeLessThan(PEAK_X);
  });
});
