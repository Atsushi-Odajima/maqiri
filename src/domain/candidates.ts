// quiet run → 削除候補(整数フレーム半開区間)。
import { MAX_CANDIDATES, MIN_CUT_FRAMES, MIN_REMOVAL_MS } from '@shared/constants';
import type { QuietRun } from './rms';
import type { AnalysisSettings } from './settings';
import { msToFrameCeil, msToFrameFloor } from './time';
import { type FrameRange, unionRanges } from './ranges';

export interface CutCandidate extends FrameRange {
  /** 元となった quiet run(ms) */
  runStartMs: number;
  runEndMs: number;
}

export interface CandidateBuildResult {
  candidates: CutCandidate[];
  /** 600 を超えた場合 true(candidates は空)。黙って捨てない。 */
  tooMany: boolean;
  tooManyCount: number;
}

/**
 * run [s,e) に対し、e-s >= minSilence かつ除去長 >= 0.1 秒なら削除案 [s+padBefore, e-padAfter)。
 * 安全丸め: a = ceil(start*30), b = floor(end*30)。b-a >= 3 のみ候補。
 * 0 / N でクリップ。重なる/接する候補は和集合化。
 */
export function buildCandidates(runs: readonly QuietRun[], settings: AnalysisSettings, totalFrames: number): CandidateBuildResult {
  const raw: CutCandidate[] = [];
  for (const run of runs) {
    const runLen = run.endMs - run.startMs;
    if (runLen < settings.minSilenceMs) continue;
    const startMs = run.startMs + settings.padBeforeMs;
    const endMs = run.endMs - settings.padAfterMs;
    if (endMs - startMs < MIN_REMOVAL_MS) continue;
    let a = msToFrameCeil(startMs);
    let b = msToFrameFloor(endMs);
    if (a < 0) a = 0;
    if (b > totalFrames) b = totalFrames;
    if (b - a < MIN_CUT_FRAMES) continue;
    raw.push({ startFrame: a, endFrame: b, runStartMs: run.startMs, runEndMs: run.endMs });
  }
  // 和集合化(run 情報は最初の run の開始と最後の run の終了を保持)
  const merged = mergeCandidates(raw);
  if (merged.length > MAX_CANDIDATES) return { candidates: [], tooMany: true, tooManyCount: merged.length };
  return { candidates: merged, tooMany: false, tooManyCount: merged.length };
}

export function mergeCandidates(cands: readonly CutCandidate[]): CutCandidate[] {
  const sorted = [...cands].sort((x, y) => x.startFrame - y.startFrame || x.endFrame - y.endFrame);
  const out: CutCandidate[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.startFrame <= last.endFrame) {
      if (c.endFrame > last.endFrame) last.endFrame = c.endFrame;
      last.runStartMs = Math.min(last.runStartMs, c.runStartMs);
      last.runEndMs = Math.max(last.runEndMs, c.runEndMs);
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

/** quiet run(ms) をフレーム範囲へ(端点調整の可動域)。run 内は [ceil(start*30), floor(end*30))。 */
export function runToFrameBounds(run: { runStartMs: number; runEndMs: number }, totalFrames: number): FrameRange {
  const s = Math.max(0, msToFrameCeil(run.runStartMs));
  const e = Math.min(totalFrames, msToFrameFloor(run.runEndMs));
  return { startFrame: s, endFrame: Math.max(s, e) };
}

export { unionRanges };
