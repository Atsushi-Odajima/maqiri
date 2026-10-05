// つなぎ目の試聴: 選択カットの前後 2 秒を、書き出しと同じ graph とフレーム規則で 720p の一時 MP4 にする。
// 元版(カットなし)と編集版(カットあり)の 2 本を作る。-ss で入力シークし、-copyts で元の時刻を保つ。
import { writeFile } from 'node:fs/promises';
import { JUNCTION_CONTEXT_SECONDS, OUTPUT_FPS } from '@shared/constants';
import type { FrameRange } from '@domain/ranges';
import { AppError } from '@shared/errors';
import { audioEncoderArgs, outputCommonArgs, type EncoderVariant } from './encoder';
import { buildFilterScript, fitOutputSize, type ColorPlan } from './filters';
import { runTool, maskPaths } from './process';
import type { MediaTools } from './tools';

export interface JunctionPlan {
  inputFile: string;
  videoStreamIndex: number;
  audioStreamIndex: number;
  t0Us: number;
  totalFrames: number;
  cut: FrameRange;
  displayWidth: number;
  displayHeight: number;
  channels: number;
  color: ColorPlan;
}

export interface JunctionWindow {
  startFrame: number;
  endFrame: number;
}

/** 前後 2 秒(2 秒未満なら動画端でクリップ)。 */
export function junctionWindow(cut: FrameRange, totalFrames: number): JunctionWindow {
  const ctx = JUNCTION_CONTEXT_SECONDS * OUTPUT_FPS;
  return { startFrame: Math.max(0, cut.startFrame - ctx), endFrame: Math.min(totalFrames, cut.endFrame + ctx) };
}

export function planJunctionArgs(plan: JunctionPlan, edited: boolean, variant: EncoderVariant, scriptPath: string, outPath: string): { args: string[]; filterScript: string; expectedFrames: number } {
  const win = junctionWindow(plan.cut, plan.totalFrames);
  const { width, height } = fitOutputSize(plan.displayWidth, plan.displayHeight, 1280, 720);
  const cuts = edited ? [plan.cut] : [];
  const filterScript = buildFilterScript(
    { inputLabel: `0:${plan.videoStreamIndex}`, t0Us: plan.t0Us, totalFrames: plan.totalFrames, cuts, outWidth: width, outHeight: height, color: plan.color, startFrame: win.startFrame, windowEndFrame: win.endFrame, outputLabel: 'vout' },
    { inputLabel: `0:${plan.audioStreamIndex}`, t0Us: plan.t0Us, totalFrames: plan.totalFrames, cuts, startFrame: win.startFrame, windowEndFrame: win.endFrame, outputLabel: 'aout' }
  );
  // 入力シーク位置は T0 + startFrame/30 から 1 秒前(キーフレーム依存の取りこぼしを避ける余裕)。
  // -copyts で元の PTS を維持するので、正規化(setpts=PTS-T0)は書き出しと同一。
  const seekSec = Math.max(0, plan.t0Us / 1_000_000 + win.startFrame / OUTPUT_FPS - 1);
  const expectedFrames = win.endFrame - win.startFrame - (edited ? plan.cut.endFrame - plan.cut.startFrame : 0);
  const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-y', '-protocol_whitelist', 'file,pipe'];
  if (seekSec > 0) args.push('-ss', seekSec.toFixed(6), '-copyts', '-accurate_seek');
  args.push('-i', plan.inputFile, '-filter_complex_script', scriptPath, '-map', '[vout]', '-map', '[aout]', ...variant.args(3000, 4000), ...audioEncoderArgs(plan.channels, 128), ...outputCommonArgs(), outPath);
  return { args, filterScript, expectedFrames };
}

export async function renderJunction(tools: MediaTools, plan: JunctionPlan, edited: boolean, variant: EncoderVariant, scriptPath: string, outPath: string, signal?: AbortSignal): Promise<{ expectedFrames: number }> {
  const inv = planJunctionArgs(plan, edited, variant, scriptPath, outPath);
  await writeFile(scriptPath, inv.filterScript, 'utf8');
  const r = await runTool(tools.ffmpeg, { args: inv.args, timeoutMs: 10 * 60_000, stallTimeoutMs: 2 * 60_000, gracefulQuit: true, ...(signal ? { signal } : {}) });
  if (r.cancelled) throw new AppError('E_CANCELLED', 'キャンセルしました。');
  if (r.code !== 0) throw new AppError('E_ENCODE', 'つなぎ目の試聴用動画を作成できませんでした。', { nextAction: 'もう一度試してください。', detail: maskPaths(r.stderrTail) });
  return { expectedFrames: inv.expectedFrames };
}
