import { describe, expect, it } from 'vitest';
import { matchPreset, normalizeSettings, settingsFromPreset, splitTotalPad } from '@domain/settings';

describe('settings', () => {
  it('presets', () => {
    expect(settingsFromPreset('natural')).toEqual({ thresholdDb: -35, minSilenceMs: 800, padBeforeMs: 150, padAfterMs: 150 });
    expect(settingsFromPreset('relaxed')).toEqual({ thresholdDb: -38, minSilenceMs: 1200, padBeforeMs: 250, padAfterMs: 250 });
    expect(settingsFromPreset('short')).toEqual({ thresholdDb: -32, minSilenceMs: 600, padBeforeMs: 100, padAfterMs: 100 });
    expect(matchPreset(settingsFromPreset('short'))).toBe('short');
    expect(matchPreset({ thresholdDb: -33, minSilenceMs: 600, padBeforeMs: 100, padAfterMs: 100 })).toBeNull();
  });
  it('normalizes to range and step', () => {
    expect(normalizeSettings({ thresholdDb: -35.4, minSilenceMs: 812, padBeforeMs: 1000, padAfterMs: 10 })).toEqual({ thresholdDb: -35, minSilenceMs: 800, padBeforeMs: 600, padAfterMs: 80 });
  });
  it('splits total pad into halves', () => {
    expect(splitTotalPad(300)).toEqual({ padBeforeMs: 150, padAfterMs: 150 });
    expect(splitTotalPad(500)).toEqual({ padBeforeMs: 250, padAfterMs: 250 });
    expect(splitTotalPad(160)).toEqual({ padBeforeMs: 80, padAfterMs: 80 });
  });
});
