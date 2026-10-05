import { describe, expect, it } from 'vitest';
import { combineChannelRms, findQuietRuns, isQuiet, quietRatio, rmsToDbfs, windowRms } from '@domain/rms';

describe('rms / dBFS', () => {
  it('dBFS floor is -160 and 1.0 is 0 dB', () => {
    expect(rmsToDbfs(0)).toBe(-160);
    expect(rmsToDbfs(1)).toBeCloseTo(0, 9);
    expect(rmsToDbfs(0.1)).toBeCloseTo(-20, 9);
  });
  it('threshold boundary: equal is NOT quiet, slightly below is quiet', () => {
    expect(isQuiet(-35, -35)).toBe(false);
    expect(isQuiet(-35.1, -35)).toBe(true);
    expect(isQuiet(-34.9, -35)).toBe(false);
  });
  it('channel RMS max keeps left-only speech and out-of-phase stereo', () => {
    // 左のみ発話、右無音
    expect(combineChannelRms([0.2, 0])).toBe(0.2);
    // 左右逆相: 単純平均なら 0 になるが、チャンネル別なら残る
    const n = 960;
    const inter = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const v = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
      inter[i * 2] = v;
      inter[i * 2 + 1] = -v;
    }
    const perCh = windowRms(inter, 0, n, 2);
    expect(perCh[0]).toBeGreaterThan(0.3);
    expect(perCh[1]).toBeGreaterThan(0.3);
    expect(combineChannelRms(perCh)).toBeGreaterThan(0.3);
    const avg = inter.reduce((acc, v, i) => (i % 2 === 0 ? acc + (v + (inter[i + 1] ?? 0)) / 2 : acc), 0);
    expect(Math.abs(avg)).toBeLessThan(1e-6);
  });
  it('quiet runs split on a single voiced window, windows are 20ms', () => {
    const db = new Array(10).fill(-60);
    db[4] = -20; // 1 窓だけ有声
    const runs = findQuietRuns(db, -35);
    expect(runs).toEqual([
      { startMs: 0, endMs: 80 },
      { startMs: 100, endMs: 200 }
    ]);
  });
  it('run exactly at 799ms vs 800ms', () => {
    // 40 windows = 800ms quiet
    const db40 = [-20, ...new Array(40).fill(-60), -20];
    expect(findQuietRuns(db40, -35)).toEqual([{ startMs: 20, endMs: 820 }]);
    // 39 windows = 780ms (799ms は 20ms 窓では表現できないので 780 と 800 の境界で確認)
    const db39 = [-20, ...new Array(39).fill(-60), -20];
    expect(findQuietRuns(db39, -35)[0]).toEqual({ startMs: 20, endMs: 800 });
  });
  it('quiet ratio', () => {
    expect(quietRatio([-60, -60, -20, -60], -35)).toBe(0.75);
    expect(quietRatio([], -35)).toBe(0);
  });
});
