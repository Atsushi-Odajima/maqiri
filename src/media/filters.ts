// filter_complex スクリプトの生成。すべて整数で検証し、外部文字列を式に埋めない。
//
// 変数の意味(混同しないこと):
//  - プロジェクト総フレーム N(totalFrames): ceil(D*30)。trim=end_frame と apad=whole_len に使う。
//  - setpts=N/(30*TB) の N: そのフィルタに到着した出力フレーム番号(0 始まり)。
//  - asetpts=N/SR/TB の N: そのフィルタでの出力サンプル番号。
//  - select/aselect の n: フィルタへ到着したフレーム番号(0 始まり)= 正規化後の元フレーム番号(startFrame 起点)。
import { OUTPUT_FPS, OUTPUT_SAMPLE_RATE, SAMPLES_PER_FRAME } from '@shared/constants';
import type { FrameRange } from '@domain/ranges';
import { unionRanges } from '@domain/ranges';

export interface ColorPlan {
  /** 入力の色行列(bt709/smpte170m/bt470bg など)。不明なら null */
  inMatrix: string | null;
  inRange: 'tv' | 'pc' | null;
}

export interface VideoGraphOptions {
  inputLabel: string; // 例 "0:0"(絶対ストリーム番号)
  t0Us: number;
  totalFrames: number;
  cuts: readonly FrameRange[];
  outWidth: number;
  outHeight: number;
  color: ColorPlan;
  /** 先頭オフセット(フレーム)。ジャンクション試聴で -ss を使う場合に設定。通常 0 */
  startFrame?: number;
  /** 出力に含める範囲 [startFrame, windowEndFrame)。省略時は末尾まで */
  windowEndFrame?: number;
  outputLabel: string;
}

export interface AudioGraphOptions {
  inputLabel: string;
  t0Us: number;
  totalFrames: number;
  cuts: readonly FrameRange[];
  startFrame?: number;
  windowEndFrame?: number;
  outputLabel: string;
}

function assertInt(name: string, v: number, min = 0): void {
  if (!Number.isInteger(v) || v < min) throw new RangeError(`${name} must be an integer >= ${min}, got ${v}`);
}

export function validateCuts(cuts: readonly FrameRange[], totalFrames: number): FrameRange[] {
  for (const c of cuts) {
    assertInt('startFrame', c.startFrame);
    assertInt('endFrame', c.endFrame, 1);
    if (c.endFrame <= c.startFrame) throw new RangeError('cut endFrame must be > startFrame');
    if (c.endFrame > totalFrames) throw new RangeError('cut exceeds totalFrames');
  }
  return unionRanges(cuts);
}

/**
 * 保持式: sum(between(n,a,b-1)) > 0 なら削除、保持は not。
 * base を引くと -ss 等で n の起点がずれる場合に局所番号へ変換できる。
 */
export function buildKeepExpression(cuts: readonly FrameRange[], base = 0, window?: { start: number; end: number }): string {
  const terms = cuts.map((c) => `between(n,${c.startFrame - base},${c.endFrame - 1 - base})`);
  const keep = terms.length ? `not(${terms.join('+')})` : '1';
  if (window) return `${keep}*between(n,${window.start - base},${window.end - 1 - base})`;
  return keep;
}

function t0Expr(t0Us: number): string {
  assertInt('t0Us', Math.abs(t0Us));
  return t0Us >= 0 ? `PTS-${t0Us}/1000000/TB` : `PTS+${-t0Us}/1000000/TB`;
}

export function buildVideoChain(o: VideoGraphOptions): string {
  assertInt('totalFrames', o.totalFrames, 1);
  assertInt('outWidth', o.outWidth, 2);
  assertInt('outHeight', o.outHeight, 2);
  if (o.outWidth % 2 || o.outHeight % 2) throw new RangeError('output size must be even');
  const cuts = validateCuts(o.cuts, o.totalFrames);
  const start = o.startFrame ?? 0;
  assertInt('startFrame', start);
  if (start >= o.totalFrames) throw new RangeError('startFrame must be < totalFrames');
  const window = o.windowEndFrame !== undefined ? { start, end: o.windowEndFrame } : undefined;
  if (window) {
    assertInt('windowEndFrame', window.end, 1);
    if (window.end <= window.start || window.end > o.totalFrames) throw new RangeError('invalid window');
  }
  const scaleOpts: string[] = [`${o.outWidth}:${o.outHeight}`, 'flags=bicubic'];
  if (o.color.inMatrix && o.color.inMatrix !== 'bt709') scaleOpts.push(`in_color_matrix=${o.color.inMatrix}`);
  scaleOpts.push('out_color_matrix=bt709');
  if (o.color.inRange === 'pc') scaleOpts.push('in_range=pc');
  scaleOpts.push('out_range=tv');
  const fpsStart = start === 0 ? '0' : (start / OUTPUT_FPS).toFixed(9);
  const chain = [
    // 1) 共通 T0 へ正規化(映像)
    `setpts=${t0Expr(o.t0Us)}`,
    // 2) 30fps CFR 化。start_time で先頭スロットを固定(先頭の不足は最初のフレームを複製)
    `fps=fps=${OUTPUT_FPS}:start_time=${fpsStart}:round=near`,
    // 3) 末尾不足を最後のフレームで埋め、(N - start) 枚へクランプ
    `tpad=stop=-1:stop_mode=clone`,
    `trim=end_frame=${o.totalFrames - start}`,
    // 4) 連番 PTS(この N はこのフィルタでの出力フレーム番号)
    `setpts=N/(${OUTPUT_FPS}*TB)`,
    // 5) 削除区間 [a,b) に属する n を除外
    `select='${buildKeepExpression(cuts, start, window)}'`,
    // 6) 再び連番 PTS(select 後の出力フレーム番号)
    `setpts=N/(${OUTPUT_FPS}*TB)`,
    // 7) 寸法・SAR・色の正規化
    `scale=${scaleOpts.join(':')}`,
    'setsar=1',
    'format=yuv420p'
  ];
  return `[${o.inputLabel}]${chain.join(',')}[${o.outputLabel}]`;
}

export function buildAudioChain(o: AudioGraphOptions): string {
  assertInt('totalFrames', o.totalFrames, 1);
  const cuts = validateCuts(o.cuts, o.totalFrames);
  const start = o.startFrame ?? 0;
  assertInt('startFrame', start);
  if (start >= o.totalFrames) throw new RangeError('startFrame must be < totalFrames');
  const window = o.windowEndFrame !== undefined ? { start, end: o.windowEndFrame } : undefined;
  const totalSamples = (o.totalFrames - start) * SAMPLES_PER_FRAME;
  const chain = [
    // 1) 共通 T0 へ正規化(音声は独自の STARTPTS を使わず、元の音声遅延を保つ)
    `asetpts=${t0Expr(o.t0Us)}`,
    // 2) 48kHz。first_pts(単位 1/48000)で先頭の無音挿入/トリムを行う
    `aresample=${OUTPUT_SAMPLE_RATE}:async=1:first_pts=${start * SAMPLES_PER_FRAME}`,
    // 3) (N - start)*1600 サンプルへ pad/trim
    `apad=whole_len=${totalSamples}`,
    `atrim=end_sample=${totalSamples}`,
    // 4) 1 フレーム = 1600 サンプルへ分割(p=1 で最終フレームも 1600 へパディング)
    `asetnsamples=n=${SAMPLES_PER_FRAME}:p=1`,
    // 5) 映像と同じ n で選別
    `aselect='${buildKeepExpression(cuts, start, window)}'`,
    // 6) 連番 PTS(この N は出力サンプル番号)
    `asetpts=N/SR/TB`
  ];
  return `[${o.inputLabel}]${chain.join(',')}[${o.outputLabel}]`;
}

export function buildFilterScript(video: VideoGraphOptions, audio: AudioGraphOptions): string {
  return `${buildVideoChain(video)};\n${buildAudioChain(audio)}\n`;
}

export { fitOutputSize } from '@domain/outputSize';
