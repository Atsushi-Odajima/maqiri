// 書き出し: filter_complex_script を生成し、ffmpeg を実行して進捗を報告する。
// 一時ファイルへ書き、検証(verify.ts)の後に呼び出し側が atomic rename する。
import { writeFile } from 'node:fs/promises';
import { AUDIO_BITRATE_KBPS, OUTPUT_PRESETS, type OutputPresetId } from '@shared/constants';
import type { FrameRange } from '@domain/ranges';
import { outputFrameCount } from '@domain/keeps';
import { AppError } from '@shared/errors';
import { audioEncoderArgs, outputCommonArgs, type EncoderVariant } from './encoder';
import { buildFilterScript, fitOutputSize, type ColorPlan } from './filters';
import { runTool, maskPaths } from './process';
import type { MediaTools } from './tools';

export interface ExportPlan {
  inputFile: string;
  videoStreamIndex: number;
  audioStreamIndex: number;
  t0Us: number;
  totalFrames: number;
  cuts: readonly FrameRange[];
  displayWidth: number;
  displayHeight: number;
  channels: number;
  color: ColorPlan;
  outputPreset: OutputPresetId;
  /** 低ビットレートの全体プレビュー用(任意) */
  bitrateScale?: number;
}

export interface ExportInvocation {
  args: string[];
  filterScript: string;
  outWidth: number;
  outHeight: number;
  expectedFrames: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  encoderLabel: string;
  encoderSettings: string;
}

export function planExport(plan: ExportPlan, variant: EncoderVariant, scriptPath: string, outTmpPath: string): ExportInvocation {
  const preset = OUTPUT_PRESETS[plan.outputPreset];
  const { width, height } = fitOutputSize(plan.displayWidth, plan.displayHeight, preset.maxLong, preset.maxShort);
  const scale = plan.bitrateScale ?? 1;
  const videoKbps = Math.max(300, Math.round(preset.videoBitrateKbps * scale));
  const maxKbps = Math.max(videoKbps, Math.round(preset.maxrateKbps * scale));
  const audioKbps = plan.channels === 1 ? AUDIO_BITRATE_KBPS.mono : AUDIO_BITRATE_KBPS.stereo;
  const expectedFrames = outputFrameCount(plan.totalFrames, plan.cuts);
  if (expectedFrames <= 0) throw new AppError('E_INTERNAL', '出力フレーム数が 0 です。全削除の書き出しはできません。');
  const filterScript = buildFilterScript(
    { inputLabel: `0:${plan.videoStreamIndex}`, t0Us: plan.t0Us, totalFrames: plan.totalFrames, cuts: plan.cuts, outWidth: width, outHeight: height, color: plan.color, outputLabel: 'vout' },
    { inputLabel: `0:${plan.audioStreamIndex}`, t0Us: plan.t0Us, totalFrames: plan.totalFrames, cuts: plan.cuts, outputLabel: 'aout' }
  );
  const encArgs = variant.args(videoKbps, maxKbps);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostats',
    '-y',
    '-protocol_whitelist',
    'file,pipe',
    '-i',
    plan.inputFile,
    '-filter_complex_script',
    scriptPath,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    ...encArgs,
    ...audioEncoderArgs(plan.channels, audioKbps),
    ...outputCommonArgs(),
    '-progress',
    'pipe:1',
    outTmpPath
  ];
  return {
    args,
    filterScript,
    outWidth: width,
    outHeight: height,
    expectedFrames,
    videoBitrateKbps: videoKbps,
    audioBitrateKbps: audioKbps,
    encoderLabel: variant.label,
    encoderSettings: encArgs.join(' ')
  };
}

export interface RunExportOptions {
  signal?: AbortSignal;
  onProgress?: (ratio: number, frame: number) => void;
  timeoutMs?: number;
}

export interface RunExportResult {
  elapsedMs: number;
}

/** ffmpeg を実行する。失敗時は E_ENCODE / E_CANCELLED。 */
export async function runExport(tools: MediaTools, inv: ExportInvocation, scriptPath: string, opts: RunExportOptions = {}): Promise<RunExportResult> {
  await writeFile(scriptPath, inv.filterScript, 'utf8');
  let lastFrame = 0;
  const r = await runTool(tools.ffmpeg, {
    args: inv.args,
    timeoutMs: opts.timeoutMs ?? 6 * 60 * 60_000,
    stallTimeoutMs: 10 * 60_000,
    gracefulQuit: true,
    ...(opts.signal ? { signal: opts.signal } : {}),
    onStdoutLine: (line) => {
      const m = /^frame=(\d+)/.exec(line);
      if (m) {
        lastFrame = Number(m[1]);
        opts.onProgress?.(Math.min(0.99, lastFrame / Math.max(1, inv.expectedFrames)), lastFrame);
      }
    }
  });
  if (r.cancelled) throw new AppError('E_CANCELLED', '書き出しをキャンセルしました。');
  if (r.timedOut) throw new AppError('E_ENCODE', '書き出しが進まなくなったため中断しました。', { nextAction: 'もう一度試してください。繰り返す場合は診断ログを保存してください。', detail: maskPaths(r.stderrTail) });
  if (r.code !== 0) {
    throw new AppError('E_ENCODE', '動画の書き出しに失敗しました。', { nextAction: 'もう一度試すか、720p を選んでください。繰り返す場合は診断ログを保存してください。', detail: maskPaths(r.stderrTail) });
  }
  return { elapsedMs: r.elapsedMs };
}
