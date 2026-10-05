import { describe, expect, it } from 'vitest';
import { buildCandidates, runToFrameBounds } from '@domain/candidates';
import { settingsFromPreset } from '@domain/settings';
import { unionRanges, subtractRanges } from '@domain/ranges';
import fixture from '../fixtures/algorithm_fixture.json';

const N = 60 * 30; // 60 秒

describe('candidate building', () => {
  it('[10,12) with 自然に → [305,355), 50 frames (spec fixture)', () => {
    const s = settingsFromPreset('natural');
    expect(s).toEqual(fixture.settings);
    const r = buildCandidates([{ startMs: 10000, endMs: 12000 }], s, N);
    expect(r.tooMany).toBe(false);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ startFrame: fixture.expectedCutFrames.startFrame, endFrame: fixture.expectedCutFrames.endFrame });
    expect(r.candidates[0]!.endFrame - r.candidates[0]!.startFrame).toBe(fixture.expectedRemovedFrames);
  });
  it('run shorter than minSilence is ignored; exactly minSilence is accepted', () => {
    const s = settingsFromPreset('natural'); // min 800
    expect(buildCandidates([{ startMs: 1000, endMs: 1780 }], s, N).candidates).toHaveLength(0);
    expect(buildCandidates([{ startMs: 1000, endMs: 1800 }], s, N).candidates).toHaveLength(1);
  });
  it('pad sum >= run length yields no candidate (removal < 0.1s)', () => {
    const s = { thresholdDb: -35, minSilenceMs: 400, padBeforeMs: 300, padAfterMs: 300 };
    expect(buildCandidates([{ startMs: 0, endMs: 600 }], s, N).candidates).toHaveLength(0);
    // 400ms run, 150+150 pads → 100ms removal → exactly 0.1s → accepted? 100ms = 3 frames → yes
    const s2 = settingsFromPreset('natural');
    const r = buildCandidates([{ startMs: 1000, endMs: 1800 }], s2, N);
    // [1150, 1650) → frames ceil(34.5)=35 .. floor(49.5)=49 → 14 frames
    expect(r.candidates[0]).toMatchObject({ startFrame: 35, endFrame: 49 });
  });
  it('inward rounding never expands removal; fewer than 3 frames dropped', () => {
    const s = { thresholdDb: -35, minSilenceMs: 400, padBeforeMs: 150, padAfterMs: 150 };
    // run 400ms → removal [150,250) = 100ms → ceil(4.5)=5 .. floor(7.5)=7 → 2 frames → dropped
    expect(buildCandidates([{ startMs: 0, endMs: 400 }], s, N).candidates).toHaveLength(0);
    // run 440ms → [150,290) → 5 .. floor(8.7)=8 → 3 frames → kept
    expect(buildCandidates([{ startMs: 0, endMs: 440 }], s, N).candidates[0]).toMatchObject({ startFrame: 5, endFrame: 8 });
  });
  it('head and tail runs are treated by the same rule and clipped to [0,N)', () => {
    const s = settingsFromPreset('natural');
    const r = buildCandidates(
      [
        { startMs: 0, endMs: 2000 },
        { startMs: 58000, endMs: 60000 }
      ],
      s,
      N
    );
    expect(r.candidates).toEqual([
      expect.objectContaining({ startFrame: 5, endFrame: 55 }), // [150,1850) → ceil(4.5)=5 .. floor(55.5)=55
      expect.objectContaining({ startFrame: 1745, endFrame: 1795 })
    ]);
  });
  it('overlapping / touching candidates are unioned', () => {
    expect(
      unionRanges([
        { startFrame: 10, endFrame: 20 },
        { startFrame: 20, endFrame: 30 },
        { startFrame: 25, endFrame: 28 },
        { startFrame: 40, endFrame: 50 }
      ])
    ).toEqual([
      { startFrame: 10, endFrame: 30 },
      { startFrame: 40, endFrame: 50 }
    ]);
  });
  it('subtracting keep ranges', () => {
    expect(subtractRanges({ startFrame: 100, endFrame: 200 }, [{ startFrame: 120, endFrame: 130 }])).toEqual([
      { startFrame: 100, endFrame: 120 },
      { startFrame: 130, endFrame: 200 }
    ]);
    expect(subtractRanges({ startFrame: 100, endFrame: 200 }, [{ startFrame: 0, endFrame: 300 }])).toEqual([]);
    expect(subtractRanges({ startFrame: 100, endFrame: 200 }, [{ startFrame: 190, endFrame: 250 }])).toEqual([{ startFrame: 100, endFrame: 190 }]);
  });
  it('more than 600 candidates → tooMany with count, nothing silently dropped', () => {
    const s = { thresholdDb: -35, minSilenceMs: 400, padBeforeMs: 80, padAfterMs: 80 };
    const runs = [];
    for (let i = 0; i < 601; i++) runs.push({ startMs: i * 2000, endMs: i * 2000 + 1000 });
    const r = buildCandidates(runs, s, 601 * 2000 * 30);
    expect(r.tooMany).toBe(true);
    expect(r.tooManyCount).toBe(601);
    expect(r.candidates).toHaveLength(0);
  });
  it('run bounds for edge adjustment', () => {
    expect(runToFrameBounds({ runStartMs: 10000, runEndMs: 12000 }, N)).toEqual({ startFrame: 300, endFrame: 360 });
  });
});
