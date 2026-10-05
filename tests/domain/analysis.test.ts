import { describe, expect, it } from 'vitest';
import { analyze, candidateId } from '@domain/analysis';
import { applyKeeps, computeCutRanges, type KeepRange, type ManualCutRange } from '@domain/keeps';
import { settingsFromPreset } from '@domain/settings';
import { canRedo, canUndo, createHistory, pushHistory, redo, undo } from '@domain/history';

function makeWindows(totalMs: number, quietSpans: Array<[number, number]>, quietDb = -60, voiceDb = -20): number[] {
  const n = totalMs / 20;
  const out = new Array<number>(n).fill(voiceDb);
  for (const [s, e] of quietSpans) for (let k = s / 20; k < e / 20; k++) out[k] = quietDb;
  return out;
}

describe('analyze()', () => {
  const settings = settingsFromPreset('natural');
  it('produces [305,355) for the spec example and E = N - 50', () => {
    const windows = makeWindows(60000, [[10000, 12000]]);
    const r = analyze(windows, settings, 1800);
    expect(r.state).toBe('ok');
    expect(r.cutRanges).toEqual([expect.objectContaining({ startFrame: 305, endFrame: 355, reason: 'auto' })]);
    expect(r.outputFrames).toBe(1750);
    expect(r.candidates[0]!.id).toBe(candidateId({ startFrame: 305, endFrame: 355 }));
  });
  it('all quiet → all-quiet state, no cuts', () => {
    const windows = makeWindows(60000, [[0, 60000]]);
    const r = analyze(windows, settings, 1800);
    expect(r.state).toBe('all-quiet');
    expect(r.cutRanges).toEqual([]);
  });
  it('all voiced → no-candidates', () => {
    const r = analyze(makeWindows(60000, []), settings, 1800);
    expect(r.state).toBe('no-candidates');
  });
  it('a kept candidate restores the original, partial keeps subtract the intersection', () => {
    const windows = makeWindows(60000, [
      [10000, 12000],
      [20000, 23000]
    ]);
    const keeps: KeepRange[] = [
      { id: 'k1', reason: 'user-keep', startFrame: 305, endFrame: 355 },
      { id: 'k2', reason: 'edge-adjust', startFrame: 605, endFrame: 620 }
    ];
    const r = analyze(windows, settings, 1800, keeps);
    expect(r.candidates[0]!.status).toBe('kept');
    expect(r.candidates[1]!.status).toBe('partial');
    expect(r.cutRanges).toEqual([expect.objectContaining({ startFrame: 620, endFrame: 685 })]);
  });
  it('keeps survive re-analysis with different settings because they are frame ranges', () => {
    const windows = makeWindows(60000, [[10000, 12000]]);
    const keep: KeepRange = { id: 'k', reason: 'user-keep', startFrame: 305, endFrame: 355 };
    const relaxed = settingsFromPreset('relaxed'); // pads 250 → [10250,11750) → [308,352)
    const r = analyze(windows, relaxed, 1800, [keep]);
    expect(r.candidates[0]).toMatchObject({ startFrame: 308, endFrame: 352, status: 'kept' });
    expect(r.cutRanges).toEqual([]);
  });
  it('manual keep that splits a candidate drops pieces shorter than 3 frames', () => {
    const views = applyKeeps([{ id: 'c', startFrame: 100, endFrame: 200, runStartMs: 3000, runEndMs: 7000 }], [{ startFrame: 102, endFrame: 198 }]);
    expect(views[0]!.effective).toEqual([]);
    expect(views[0]!.status).toBe('kept');
    const views2 = applyKeeps([{ id: 'c', startFrame: 100, endFrame: 200, runStartMs: 3000, runEndMs: 7000 }], [{ startFrame: 103, endFrame: 197 }]);
    expect(views2[0]!.effective).toEqual([
      { startFrame: 100, endFrame: 103 },
      { startFrame: 197, endFrame: 200 }
    ]);
  });
  it('manual cut extensions are accepted only inside the current quiet run', () => {
    const windows = makeWindows(60000, [[10000, 12000]]);
    const ext: ManualCutRange = { id: 'm', startFrame: 302, endFrame: 305, runStartMs: 10000, runEndMs: 12000 };
    const r = analyze(windows, settings, 1800, [], [ext]);
    expect(r.cutRanges).toEqual([expect.objectContaining({ startFrame: 302, endFrame: 355, reason: 'adjusted' })]);
    // threshold change makes the run vanish → extension dropped and reported
    const r2 = analyze(windows, { ...settings, thresholdDb: -60 }, 1800, [], [ext]);
    expect(r2.droppedManualCuts).toHaveLength(1);
  });
  it('remaining < 1s → too-short-remaining', () => {
    // 2 秒の素材、quiet 0.1..1.95 → 出力が 1 秒未満
    const windows = makeWindows(2000, [[100, 1960]]);
    const r = analyze(windows, { thresholdDb: -35, minSilenceMs: 400, padBeforeMs: 80, padAfterMs: 80 }, 60);
    expect(r.state).toBe('too-short-remaining');
  });
  it('computeCutRanges merges adjacent pieces', () => {
    const views = applyKeeps(
      [
        { id: 'a', startFrame: 100, endFrame: 150, runStartMs: 0, runEndMs: 0 },
        { id: 'b', startFrame: 150, endFrame: 200, runStartMs: 0, runEndMs: 0 }
      ],
      []
    );
    const cuts = computeCutRanges(views, [], []);
    expect(cuts).toEqual([expect.objectContaining({ startFrame: 100, endFrame: 200 })]);
  });
});

describe('history', () => {
  it('undo/redo with 100 limit', () => {
    let h = createHistory(0, 100);
    for (let i = 1; i <= 150; i++) h = pushHistory(h, i);
    expect(h.past).toHaveLength(100);
    expect(h.present).toBe(150);
    let undos = 0;
    while (canUndo(h)) {
      h = undo(h);
      undos++;
    }
    expect(undos).toBe(100);
    expect(h.present).toBe(50);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(51);
    h = pushHistory(h, 999);
    expect(canRedo(h)).toBe(false);
  });
});
