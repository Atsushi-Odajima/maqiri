// 手動保持(manualKeepRanges)と手動延長(manualCutRanges)を候補へ適用して最終 cutRanges を得る。
import { MIN_CUT_FRAMES } from '@shared/constants';
import type { CutCandidate } from './candidates';
import { type FrameRange, intersectRanges, rangeLength, subtractRanges, unionRanges, containsRange } from './ranges';

export type KeepReason = 'user-keep' | 'edge-adjust';

export interface KeepRange extends FrameRange {
  id: string;
  reason: KeepReason;
  /** 保持操作時の候補 id(再解析後は一致しないことがある。フレーム区間が正本) */
  candidateId?: string | undefined;
}

export interface ManualCutRange extends FrameRange {
  id: string;
  /** 延長操作が属していた quiet run(ms)。再解析後、run 内でなければ破棄。 */
  runStartMs: number;
  runEndMs: number;
}

export interface CutRange extends FrameRange {
  id: string;
  candidateId: string;
  reason: 'auto' | 'adjusted';
}

export type CandidateStatus = 'cut' | 'kept' | 'partial';

export interface CandidateView extends CutCandidate {
  id: string;
  status: CandidateStatus;
  /** 保持差し引き後に実際に削除される区間 */
  effective: FrameRange[];
  removedFrames: number;
}

export interface IdentifiedCandidate extends CutCandidate {
  id: string;
}

/**
 * 候補に保持区間を適用。保持と交差した分だけ差し引き、3 フレーム未満の欠片は捨てる。
 */
export function applyKeeps(candidates: readonly IdentifiedCandidate[], keeps: readonly FrameRange[]): CandidateView[] {
  const keepUnion = unionRanges(keeps);
  return candidates.map((c) => {
    const pieces = subtractRanges(c, keepUnion).filter((p) => rangeLength(p) >= MIN_CUT_FRAMES);
    const removed = pieces.reduce((acc, p) => acc + rangeLength(p), 0);
    let status: CandidateStatus = 'cut';
    if (pieces.length === 0) status = 'kept';
    else if (removed < rangeLength(c)) status = 'partial';
    return { ...c, status, effective: pieces, removedFrames: removed };
  });
}

/** 手動延長区間のうち、現在の quiet run 内に収まるものだけを採用する。 */
export function filterManualCuts(manual: readonly ManualCutRange[], candidates: readonly CutCandidate[], totalFrames: number, runBounds: (c: CutCandidate) => FrameRange): { accepted: ManualCutRange[]; dropped: ManualCutRange[] } {
  const accepted: ManualCutRange[] = [];
  const dropped: ManualCutRange[] = [];
  for (const m of manual) {
    const clipped = { startFrame: Math.max(0, m.startFrame), endFrame: Math.min(totalFrames, m.endFrame) };
    if (clipped.endFrame <= clipped.startFrame) {
      dropped.push(m);
      continue;
    }
    const host = candidates.find((c) => containsRange(runBounds(c), clipped));
    if (host) accepted.push(m);
    else dropped.push(m);
  }
  return { accepted, dropped };
}

/** 最終 cutRanges。候補の effective + 採用された手動延長 − 保持。和集合化し 3 フレーム未満を捨てる。 */
export function computeCutRanges(views: readonly CandidateView[], manualCuts: readonly ManualCutRange[], keeps: readonly FrameRange[]): CutRange[] {
  const keepUnion = unionRanges(keeps);
  const out: CutRange[] = [];
  const all: Array<FrameRange & { candidateId: string; reason: 'auto' | 'adjusted' }> = [];
  for (const v of views) for (const p of v.effective) all.push({ ...p, candidateId: v.id, reason: 'auto' });
  for (const m of manualCuts) {
    for (const p of subtractRanges(m, keepUnion)) {
      const host = views.find((v) => intersectRanges(v, p) || v.endFrame === p.startFrame || v.startFrame === p.endFrame);
      all.push({ ...p, candidateId: host?.id ?? m.id, reason: 'adjusted' });
    }
  }
  const sorted = all.sort((x, y) => x.startFrame - y.startFrame || x.endFrame - y.endFrame);
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.startFrame <= last.endFrame) {
      if (r.endFrame > last.endFrame) last.endFrame = r.endFrame;
      if (r.reason === 'adjusted') last.reason = 'adjusted';
    } else {
      out.push({ id: `${r.candidateId}:${r.startFrame}`, candidateId: r.candidateId, reason: r.reason, startFrame: r.startFrame, endFrame: r.endFrame });
    }
  }
  return out.filter((r) => rangeLength(r) >= MIN_CUT_FRAMES);
}

/** 出力フレーム数 E = N − Σ(b−a)。 */
export function outputFrameCount(totalFrames: number, cuts: readonly FrameRange[]): number {
  return totalFrames - cuts.reduce((acc, c) => acc + rangeLength(c), 0);
}
