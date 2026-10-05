import { PRESETS, SETTINGS_LIMITS, type PresetId } from '@shared/constants';

export interface AnalysisSettings {
  thresholdDb: number;
  minSilenceMs: number;
  padBeforeMs: number;
  padAfterMs: number;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  thresholdDb: SETTINGS_LIMITS.thresholdDb.default,
  minSilenceMs: SETTINGS_LIMITS.minSilenceMs.default,
  padBeforeMs: SETTINGS_LIMITS.padBeforeMs.default,
  padAfterMs: SETTINGS_LIMITS.padAfterMs.default
};

function snap(value: number, limit: { min: number; max: number; step: number }): number {
  const clamped = Math.min(limit.max, Math.max(limit.min, value));
  const steps = Math.round((clamped - limit.min) / limit.step);
  return limit.min + steps * limit.step;
}

/** 範囲・刻みへ丸めた設定を返す。 */
export function normalizeSettings(s: AnalysisSettings): AnalysisSettings {
  return {
    thresholdDb: snap(s.thresholdDb, SETTINGS_LIMITS.thresholdDb),
    minSilenceMs: snap(s.minSilenceMs, SETTINGS_LIMITS.minSilenceMs),
    padBeforeMs: snap(s.padBeforeMs, SETTINGS_LIMITS.padBeforeMs),
    padAfterMs: snap(s.padAfterMs, SETTINGS_LIMITS.padAfterMs)
  };
}

export function settingsFromPreset(id: PresetId): AnalysisSettings {
  const p = PRESETS[id];
  return { thresholdDb: p.thresholdDb, minSilenceMs: p.minSilenceMs, padBeforeMs: p.padBeforeMs, padAfterMs: p.padAfterMs };
}

export function matchPreset(s: AnalysisSettings): PresetId | null {
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const p = PRESETS[id];
    if (p.thresholdDb === s.thresholdDb && p.minSilenceMs === s.minSilenceMs && p.padBeforeMs === s.padBeforeMs && p.padAfterMs === s.padAfterMs) return id;
  }
  return null;
}

/** 初心者 UI: 合計「残す間」(ms) を前後へ半分ずつ配分する。10ms 刻み。 */
export function splitTotalPad(totalMs: number): { padBeforeMs: number; padAfterMs: number } {
  const half = Math.round(totalMs / 2 / 10) * 10;
  const before = snap(half, SETTINGS_LIMITS.padBeforeMs);
  const after = snap(totalMs - before, SETTINGS_LIMITS.padAfterMs);
  return { padBeforeMs: before, padAfterMs: after };
}

export function settingsEqual(a: AnalysisSettings, b: AnalysisSettings): boolean {
  return a.thresholdDb === b.thresholdDb && a.minSilenceMs === b.minSilenceMs && a.padBeforeMs === b.padBeforeMs && a.padAfterMs === b.padAfterMs;
}
