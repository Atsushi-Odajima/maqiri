// 時刻変換。本製品の正本は 30fps の整数フレームと 48kHz の整数サンプル。
// 浮動小数の秒は表示用であり、保存・判定には使わない。
import { OUTPUT_FPS, OUTPUT_SAMPLE_RATE, SAMPLES_PER_FRAME } from '@shared/constants';

/** 整数除算(切り捨て)。x, y は整数。FP 誤差に依存しない。 */
export function floorDiv(x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || y <= 0) throw new RangeError('floorDiv expects integers, y > 0');
  let q = Math.floor(x / y);
  if (q * y > x) q -= 1;
  else if ((q + 1) * y <= x) q += 1;
  return q;
}

/** 整数除算(切り上げ)。 */
export function ceilDiv(x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || y <= 0) throw new RangeError('ceilDiv expects integers, y > 0');
  return -floorDiv(-x, y);
}

/** ミリ秒(整数) → フレーム。切り上げ(削除開始は内側へ丸める)。 */
export function msToFrameCeil(ms: number): number {
  return ceilDiv(ms * OUTPUT_FPS, 1000);
}

/** ミリ秒(整数) → フレーム。切り捨て(削除終了は内側へ丸める)。 */
export function msToFrameFloor(ms: number): number {
  return floorDiv(ms * OUTPUT_FPS, 1000);
}

/** マイクロ秒(整数) → 総フレーム数 N = ceil(D*30)。 */
export function durationUsToFrameCount(durationUs: number): number {
  if (!Number.isInteger(durationUs) || durationUs <= 0) throw new RangeError('durationUs must be a positive integer');
  return ceilDiv(durationUs * OUTPUT_FPS, 1_000_000);
}

export function framesToSamples(frames: number): number {
  return frames * SAMPLES_PER_FRAME;
}

/** 表示用: フレーム → 秒(浮動小数)。正本へ逆変換しないこと。 */
export function frameToSeconds(frame: number): number {
  return frame / OUTPUT_FPS;
}

/** 表示用: フレーム → "mm:ss.ff"(ff はフレーム番号 00-29)。 */
export function formatFrameTimecode(frame: number): string {
  const total = Math.max(0, Math.floor(frame));
  const ff = total % OUTPUT_FPS;
  const s = Math.floor(total / OUTPUT_FPS);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ff).padStart(2, '0')}`;
}

/** 表示用: フレーム → "m:ss"(分:秒)。 */
export function formatFrameClock(frame: number): string {
  const s = Math.floor(Math.max(0, frame) / OUTPUT_FPS);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

/** 表示用: フレーム数 → 秒を小数2桁(四捨五入)。 */
export function formatFramesAsSeconds(frames: number, digits = 2): string {
  return (frames / OUTPUT_FPS).toFixed(digits);
}

export function secondsToUs(seconds: number): number {
  return Math.round(seconds * 1_000_000);
}

export { OUTPUT_FPS, OUTPUT_SAMPLE_RATE, SAMPLES_PER_FRAME };
