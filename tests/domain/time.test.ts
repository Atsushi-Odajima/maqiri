import { describe, expect, it } from 'vitest';
import { ceilDiv, durationUsToFrameCount, floorDiv, formatFrameTimecode, msToFrameCeil, msToFrameFloor } from '@domain/time';

describe('integer division', () => {
  it('floorDiv / ceilDiv are exact', () => {
    expect(floorDiv(7, 2)).toBe(3);
    expect(floorDiv(-7, 2)).toBe(-4);
    expect(ceilDiv(7, 2)).toBe(4);
    expect(ceilDiv(-7, 2)).toBe(-3);
    expect(ceilDiv(30300, 100)).toBe(303);
    expect(floorDiv(30300, 100)).toBe(303);
    // large values near 2^53 / 1000 boundary are still exact for our domain
    expect(floorDiv(1_800_000 * 30, 1000)).toBe(54000);
  });
  it('ms → frame uses inward rounding', () => {
    expect(msToFrameCeil(10150)).toBe(305); // 10.15 * 30 = 304.5 → 305
    expect(msToFrameFloor(11850)).toBe(355); // 11.85 * 30 = 355.5 → 355
    expect(msToFrameCeil(10000)).toBe(300);
    expect(msToFrameFloor(10000)).toBe(300);
    expect(msToFrameCeil(10170)).toBe(306); // 305.1 → 306
    expect(msToFrameFloor(10170)).toBe(305);
  });
  it('N = ceil(D*30) from integer microseconds', () => {
    expect(durationUsToFrameCount(1_000_000)).toBe(30);
    expect(durationUsToFrameCount(1_000_001)).toBe(31);
    expect(durationUsToFrameCount(90_000_000)).toBe(2700);
    expect(() => durationUsToFrameCount(0)).toThrow();
  });
  it('timecode formatting', () => {
    expect(formatFrameTimecode(0)).toBe('00:00.00');
    expect(formatFrameTimecode(305)).toBe('00:10.05');
    expect(formatFrameTimecode(30 * 61 + 29)).toBe('01:01.29');
  });
});
