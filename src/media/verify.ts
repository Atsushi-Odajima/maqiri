// 完成物の検証: 映像フレーム数 = E、音声長の差 48ms 以内、A/V 終端差 50ms 以内、codec/fps/寸法。
import { EXPORT_TOLERANCE, OUTPUT_FPS, SAMPLES_PER_FRAME } from '@shared/constants';
import { AppError } from '@shared/errors';
import { runTool, maskPaths } from './process';
import type { MediaTools } from './tools';
import { parseRational } from './probe';

export interface OutputVerification {
  ok: boolean;
  videoFrameCount: { expected: number; actual: number; ok: boolean };
  audioDurationMs: { expected: number; actual: number; diffMs: number; ok: boolean };
  avEndDiffMs: { diffMs: number; ok: boolean };
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  frameRate: string;
  sampleRate: number;
  channels: number;
  containerDurationUs: number;
  problems: string[];
}

interface StreamRow {
  index: number;
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string | number;
  nb_read_frames?: string | number;
  nb_read_packets?: string | number;
  sample_rate?: string | number;
  channels?: number;
  side_data_list?: Array<Record<string, unknown>>;
}

export async function verifyOutput(tools: MediaTools, file: string, expectedFrames: number, expectedWidth: number, expectedHeight: number, expectedChannels: number, signal?: AbortSignal): Promise<OutputVerification> {
  // 映像フレーム数は MP4 のサンプル数(= パケット数、1 パケット 1 フレーム)で数える。
  // -count_frames は 1080p 全体のデコードが必要で 10 分素材に 100 秒以上かかるため使わない。
  const probe = await runTool(tools.ffprobe, {
    args: ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-count_packets', file],
    timeoutMs: 30 * 60_000,
    stallTimeoutMs: 5 * 60_000,
    ...(signal ? { signal } : {})
  });
  if (probe.cancelled) throw new AppError('E_CANCELLED', 'キャンセルしました。');
  if (probe.code !== 0) throw new AppError('E_SYNC', '完成した動画を検証できませんでした。', { detail: maskPaths(probe.stderrTail) });
  const json = JSON.parse(probe.stdoutText || '{}') as { streams?: StreamRow[]; format?: { duration?: string | number } };
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const problems: string[] = [];
  if (!v || !a) throw new AppError('E_SYNC', '完成した動画に映像または音声がありません。');
  if (streams.length !== 2) problems.push(`出力ストリーム数が 2 ではありません(${streams.length})`);

  // 音声のデコード後サンプル数(nb_samples の合計)
  const frames = await runTool(tools.ffprobe, {
    args: ['-v', 'error', '-select_streams', String(a.index), '-show_entries', 'frame=nb_samples', '-of', 'csv=p=0', file],
    timeoutMs: 30 * 60_000,
    stallTimeoutMs: 5 * 60_000,
    ...(signal ? { signal } : {})
  });
  if (frames.cancelled) throw new AppError('E_CANCELLED', 'キャンセルしました。');
  let samples = 0;
  for (const line of frames.stdoutText.split('\n')) {
    const n = Number(line.trim());
    if (Number.isFinite(n)) samples += n;
  }
  const sampleRate = Number(a.sample_rate ?? 0) || 48000;
  const actualAudioMs = (samples / sampleRate) * 1000;
  const expectedAudioMs = (expectedFrames * SAMPLES_PER_FRAME * 1000) / 48000;
  const audioDiff = actualAudioMs - expectedAudioMs;
  const audioOk = Math.abs(audioDiff) <= EXPORT_TOLERANCE.audioDurationMs;
  if (!audioOk) problems.push(`音声長の差が ${audioDiff.toFixed(1)}ms(許容 ±${EXPORT_TOLERANCE.audioDurationMs}ms)`);

  const actualFrames = Number(v.nb_read_packets ?? NaN);
  const framesOk = actualFrames === expectedFrames;
  if (!framesOk) problems.push(`映像フレーム数 ${actualFrames} ≠ 期待 ${expectedFrames}`);

  const vDur = Number(v.duration ?? NaN);
  const aDur = Number(a.duration ?? NaN);
  const avDiff = Number.isFinite(vDur) && Number.isFinite(aDur) ? (vDur - aDur) * 1000 : NaN;
  const avOk = Number.isFinite(avDiff) && Math.abs(avDiff) <= EXPORT_TOLERANCE.avEndDiffMs;
  if (!avOk) problems.push(`映像/音声の終端差 ${Number.isFinite(avDiff) ? avDiff.toFixed(1) : '不明'}ms(許容 ±${EXPORT_TOLERANCE.avEndDiffMs}ms)`);

  if (v.codec_name !== 'h264') problems.push(`映像コーデック ${v.codec_name}`);
  if (a.codec_name !== 'aac') problems.push(`音声コーデック ${a.codec_name}`);
  const fr = parseRational(v.r_frame_rate);
  if (!fr || Math.abs(fr.num / fr.den - OUTPUT_FPS) > 1e-6) problems.push(`フレームレート ${v.r_frame_rate}`);
  if (v.width !== expectedWidth || v.height !== expectedHeight) problems.push(`寸法 ${v.width}×${v.height} ≠ ${expectedWidth}×${expectedHeight}`);
  if ((a.channels ?? 0) !== expectedChannels) problems.push(`チャンネル数 ${a.channels} ≠ ${expectedChannels}`);
  if (sampleRate !== 48000) problems.push(`サンプルレート ${sampleRate}`);
  if ((v.side_data_list ?? []).some((sd) => 'rotation' in sd)) problems.push('出力に回転メタデータが残っています');

  const containerDurationUs = Math.round(Number(json.format?.duration ?? vDur) * 1_000_000);
  return {
    ok: problems.length === 0,
    videoFrameCount: { expected: expectedFrames, actual: actualFrames, ok: framesOk },
    audioDurationMs: { expected: expectedAudioMs, actual: actualAudioMs, diffMs: audioDiff, ok: audioOk },
    avEndDiffMs: { diffMs: Number.isFinite(avDiff) ? avDiff : NaN, ok: avOk },
    videoCodec: v.codec_name ?? '',
    audioCodec: a.codec_name ?? '',
    width: v.width ?? 0,
    height: v.height ?? 0,
    frameRate: v.r_frame_rate ?? '',
    sampleRate,
    channels: a.channels ?? 0,
    containerDurationUs,
    problems
  };
}
