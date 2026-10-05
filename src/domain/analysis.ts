// 解析パイプライン: 窓 dB 列 + 設定 → 候補・保持適用・最終 cutRanges・状態判定。
import { ALL_QUIET_RATIO, MIN_REMAINING_SECONDS, OUTPUT_FPS } from '@shared/constants';
import { buildCandidates, runToFrameBounds, type CutCandidate } from './candidates';
import { applyKeeps, computeCutRanges, filterManualCuts, outputFrameCount, type CandidateView, type CutRange, type IdentifiedCandidate, type KeepRange, type ManualCutRange } from './keeps';
import { findQuietRuns, quietRatio } from './rms';
import type { AnalysisSettings } from './settings';

export type AnalysisState = 'ok' | 'no-candidates' | 'all-quiet' | 'too-many' | 'too-short-remaining';

export interface AnalysisResult {
  state: AnalysisState;
  totalFrames: number;
  quietRatio: number;
  candidateCount: number;
  tooManyCount: number;
  candidates: CandidateView[];
  cutRanges: CutRange[];
  outputFrames: number;
  /** 再解析で quiet run 外になり破棄された手動延長 */
  droppedManualCuts: ManualCutRange[];
}

/** 候補 id は解析 revision に依存しない決定的な値(フレーム範囲)にする。 */
export function candidateId(c: { startFrame: number; endFrame: number }): string {
  return `c${c.startFrame}-${c.endFrame}`;
}

export function identify(cands: readonly CutCandidate[]): IdentifiedCandidate[] {
  return cands.map((c) => ({ ...c, id: candidateId(c) }));
}

export function analyze(windowDb: ArrayLike<number>, settings: AnalysisSettings, totalFrames: number, keeps: readonly KeepRange[] = [], manualCuts: readonly ManualCutRange[] = []): AnalysisResult {
  const qr = quietRatio(windowDb, settings.thresholdDb);
  const runs = findQuietRuns(windowDb, settings.thresholdDb);
  const built = buildCandidates(runs, settings, totalFrames);
  const base: AnalysisResult = {
    state: 'ok',
    totalFrames,
    quietRatio: qr,
    candidateCount: built.candidates.length,
    tooManyCount: built.tooManyCount,
    candidates: [],
    cutRanges: [],
    outputFrames: totalFrames,
    droppedManualCuts: []
  };
  if (built.tooMany) return { ...base, state: 'too-many' };
  if (qr >= ALL_QUIET_RATIO) {
    // 全無音: 誤トラックの確認と「編集せず保存」を案内。空 MP4 は作らない。
    return { ...base, state: 'all-quiet' };
  }
  const identified = identify(built.candidates);
  const views = applyKeeps(identified, keeps);
  const { accepted, dropped } = filterManualCuts(manualCuts, built.candidates, totalFrames, (c) => runToFrameBounds(c, totalFrames));
  const cutRanges = computeCutRanges(views, accepted, keeps);
  const outputFrames = outputFrameCount(totalFrames, cutRanges);
  let state: AnalysisState = 'ok';
  if (identified.length === 0) state = 'no-candidates';
  else if (outputFrames < MIN_REMAINING_SECONDS * OUTPUT_FPS) state = 'too-short-remaining';
  return { ...base, state, candidates: views, cutRanges, outputFrames, droppedManualCuts: dropped };
}

/** 端点調整の可動域(元 quiet run 内)。 */
export function candidateBounds(c: CutCandidate, totalFrames: number): { startFrame: number; endFrame: number } {
  return runToFrameBounds(c, totalFrames);
}

/** 保護余白を割るか(余白の中へ削除が入り込むか)。 */
export function breaksProtectivePad(c: CutCandidate, proposed: { startFrame: number; endFrame: number }): boolean {
  return proposed.startFrame < c.startFrame || proposed.endFrame > c.endFrame;
}
