// 半開区間 [startFrame, endFrame) の整数フレーム範囲演算。
export interface FrameRange {
  startFrame: number;
  endFrame: number;
}

export function isValidRange(r: FrameRange): boolean {
  return Number.isInteger(r.startFrame) && Number.isInteger(r.endFrame) && r.startFrame >= 0 && r.endFrame > r.startFrame;
}

export function rangeLength(r: FrameRange): number {
  return r.endFrame - r.startFrame;
}

export function sortRanges<T extends FrameRange>(ranges: readonly T[]): T[] {
  return [...ranges].sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
}

/** 重なる/接する区間を和集合化。入力は任意順。 */
export function unionRanges(ranges: readonly FrameRange[]): FrameRange[] {
  const sorted = sortRanges(ranges.filter(isValidRange));
  const out: FrameRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.startFrame <= last.endFrame) {
      if (r.endFrame > last.endFrame) last.endFrame = r.endFrame;
    } else {
      out.push({ startFrame: r.startFrame, endFrame: r.endFrame });
    }
  }
  return out;
}

/** a から b(複数)を差し引く。結果は昇順の区間列。 */
export function subtractRanges(a: FrameRange, subtrahends: readonly FrameRange[]): FrameRange[] {
  let pieces: FrameRange[] = [{ startFrame: a.startFrame, endFrame: a.endFrame }];
  for (const s of unionRanges(subtrahends)) {
    const next: FrameRange[] = [];
    for (const p of pieces) {
      if (s.endFrame <= p.startFrame || s.startFrame >= p.endFrame) {
        next.push(p);
        continue;
      }
      if (s.startFrame > p.startFrame) next.push({ startFrame: p.startFrame, endFrame: s.startFrame });
      if (s.endFrame < p.endFrame) next.push({ startFrame: s.endFrame, endFrame: p.endFrame });
    }
    pieces = next;
  }
  return pieces;
}

export function intersectRanges(a: FrameRange, b: FrameRange): FrameRange | null {
  const s = Math.max(a.startFrame, b.startFrame);
  const e = Math.min(a.endFrame, b.endFrame);
  return e > s ? { startFrame: s, endFrame: e } : null;
}

export function rangesOverlap(a: FrameRange, b: FrameRange): boolean {
  return intersectRanges(a, b) !== null;
}

export function containsRange(outer: FrameRange, inner: FrameRange): boolean {
  return outer.startFrame <= inner.startFrame && inner.endFrame <= outer.endFrame;
}

export function totalFrames(ranges: readonly FrameRange[]): number {
  return ranges.reduce((acc, r) => acc + rangeLength(r), 0);
}

/** 範囲 [0, limit) にクリップ。空になれば null。 */
export function clipRange(r: FrameRange, limit: number): FrameRange | null {
  const s = Math.max(0, r.startFrame);
  const e = Math.min(limit, r.endFrame);
  return e > s ? { startFrame: s, endFrame: e } : null;
}
