// 20ms 窓の RMS → dBFS と quiet 判定。
import { ANALYSIS_WINDOW_MS, DB_FLOOR } from '@shared/constants';

/** RMS(線形, 0..1) → dBFS。下限 -160。 */
export function rmsToDbfs(rms: number): number {
  const v = Math.max(rms, 1e-8);
  const db = 20 * Math.log10(v);
  return Math.max(DB_FLOOR, db);
}

/**
 * チャンネル別 RMS の最大を採用する。ステレオを単純平均して逆相の声を消さない。
 * @param channelRms 各チャンネルの RMS(線形)
 */
export function combineChannelRms(channelRms: readonly number[]): number {
  let m = 0;
  for (const v of channelRms) if (v > m) m = v;
  return m;
}

/** Float32 のインターリーブ PCM から窓ごとのチャンネル別 RMS を計算する補助。 */
export function windowRms(samples: Float32Array, offset: number, frames: number, channels: number): number[] {
  const sums = new Array<number>(channels).fill(0);
  const end = offset + frames * channels;
  for (let i = offset, c = 0; i < end; i++) {
    const s = samples[i] ?? 0;
    sums[c] = (sums[c] ?? 0) + s * s;
    c = c + 1 === channels ? 0 : c + 1;
  }
  return sums.map((sum) => Math.sqrt(sum / Math.max(1, frames)));
}

/** quiet 判定: 閾値未満のみ quiet。等しい場合は保持(有声扱い)。 */
export function isQuiet(windowDb: number, thresholdDb: number): boolean {
  return windowDb < thresholdDb;
}

export interface QuietRun {
  /** 開始(ms, 整数, 20ms の倍数) */
  startMs: number;
  /** 終了(ms, 整数, 排他) */
  endMs: number;
}

/**
 * 窓ごとの dB 列から連続 quiet run を抽出する。途中に有声窓が 1 つでもあれば別 run。
 * 窓 k は [k*20ms, (k+1)*20ms)。
 */
export function findQuietRuns(windowDb: ArrayLike<number>, thresholdDb: number, windowMs: number = ANALYSIS_WINDOW_MS): QuietRun[] {
  const runs: QuietRun[] = [];
  let runStart = -1;
  const n = windowDb.length;
  for (let k = 0; k < n; k++) {
    const q = isQuiet(windowDb[k] as number, thresholdDb);
    if (q && runStart < 0) runStart = k;
    if (!q && runStart >= 0) {
      runs.push({ startMs: runStart * windowMs, endMs: k * windowMs });
      runStart = -1;
    }
  }
  if (runStart >= 0) runs.push({ startMs: runStart * windowMs, endMs: n * windowMs });
  return runs;
}

export function quietRatio(windowDb: ArrayLike<number>, thresholdDb: number): number {
  const n = windowDb.length;
  if (n === 0) return 0;
  let q = 0;
  for (let k = 0; k < n; k++) if (isQuiet(windowDb[k] as number, thresholdDb)) q++;
  return q / n;
}
