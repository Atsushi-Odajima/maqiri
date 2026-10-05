// ffprobe による素材検査。container/stream の実体、T0、D、回転、SAR、色、音声トラックを確定する。
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '@shared/errors';
import { MAX_LONG_SIDE, MAX_SHORT_SIDE, MAX_SOURCE_BYTES, MAX_SOURCE_DURATION_SECONDS } from '@shared/constants';
import type { AudioTrackInfo, ColorInfo, SourceInfo } from '@shared/types';
import { durationUsToFrameCount } from '@domain/time';
import { runTool, maskPaths } from './process';
import type { MediaTools } from './tools';

const numStr = z.union([z.string(), z.number()]).transform((v) => Number(v));

const streamSchema = z.object({
  index: z.number().int(),
  codec_type: z.string(),
  codec_name: z.string().optional(),
  codec_tag_string: z.string().optional(),
  profile: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  coded_width: z.number().int().optional(),
  coded_height: z.number().int().optional(),
  pix_fmt: z.string().optional(),
  field_order: z.string().optional(),
  color_range: z.string().optional(),
  color_space: z.string().optional(),
  color_transfer: z.string().optional(),
  color_primaries: z.string().optional(),
  sample_aspect_ratio: z.string().optional(),
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  time_base: z.string().optional(),
  start_time: numStr.optional(),
  duration: numStr.optional(),
  bits_per_raw_sample: numStr.optional(),
  sample_rate: numStr.optional(),
  channels: z.number().int().optional(),
  channel_layout: z.string().optional(),
  disposition: z.record(z.string(), z.number()).optional(),
  tags: z.record(z.string(), z.string()).optional(),
  side_data_list: z.array(z.record(z.string(), z.unknown())).optional()
});

const probeJsonSchema = z.object({
  format: z
    .object({
      format_name: z.string().optional(),
      format_long_name: z.string().optional(),
      duration: numStr.optional(),
      size: numStr.optional(),
      bit_rate: numStr.optional(),
      nb_streams: z.number().int().optional()
    })
    .optional(),
  streams: z.array(streamSchema).optional(),
  error: z.object({ code: z.number().optional(), string: z.string().optional() }).optional()
});

export type ProbeJson = z.infer<typeof probeJsonSchema>;
type Stream = z.infer<typeof streamSchema>;

export interface ProbeProgress {
  stage: string;
  ratio: number | null;
}

export function parseRational(s: string | undefined): { num: number; den: number } | null {
  if (!s) return null;
  const m = /^(-?\d+)\s*[/:]\s*(\d+)$/.exec(s.trim());
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return { num, den };
}

/** tb 単位の整数 → µs。BigInt で桁あふれを避け、最近傍へ丸める。 */
export function tbToUs(value: bigint, tb: { num: number; den: number }): number {
  const n = value * BigInt(tb.num) * 1_000_000n;
  const d = BigInt(tb.den);
  let q = n / d;
  const r = n - q * d; // 符号は n に従う
  if (r * 2n >= d) q += 1n;
  else if (r * 2n <= -d) q -= 1n;
  return Number(q);
}

function normalizeRotation(raw: number): 0 | 90 | 180 | 270 {
  let r = Math.round(raw) % 360;
  if (r < 0) r += 360;
  if (r === 90 || r === 180 || r === 270) return r;
  return 0;
}

/**
 * 回転。ffprobe の display matrix "rotation" は反時計回りが正(例: -90 = 時計回り 90°)。
 * tags.rotate は時計回り。両方あれば display matrix を優先し、二重適用しない。
 */
export function rotationOf(stream: Pick<Stream, 'side_data_list' | 'tags'>): 0 | 90 | 180 | 270 {
  for (const sd of stream.side_data_list ?? []) {
    const rot = sd['rotation'];
    if (typeof rot === 'number' && Number.isFinite(rot)) return normalizeRotation(-rot);
  }
  const tag = stream.tags?.['rotate'];
  if (tag && /^-?\d+$/.test(tag)) return normalizeRotation(Number(tag));
  return 0;
}

function hasSideData(stream: Stream, needle: string): boolean {
  return (stream.side_data_list ?? []).some((sd) => String(sd['side_data_type'] ?? '').toLowerCase().includes(needle));
}

export async function probeContainer(tools: MediaTools, file: string, signal?: AbortSignal): Promise<ProbeJson> {
  const r = await runTool(tools.ffprobe, {
    args: ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_error', file],
    timeoutMs: 120_000,
    ...(signal ? { signal } : {})
  });
  if (r.cancelled) throw new AppError('E_CANCELLED', 'キャンセルしました。');
  let parsed: ProbeJson;
  try {
    parsed = probeJsonSchema.parse(JSON.parse(r.stdoutText || '{}'));
  } catch (e) {
    throw new AppError('E_FORMAT', 'この動画の形式を読み取れませんでした。', {
      nextAction: '対応形式(MP4/MOV、H.264/HEVC、AAC/PCM)の動画を選び直してください。',
      detail: maskPaths(`${r.stderrTail}\n${e instanceof Error ? e.message : String(e)}`)
    });
  }
  if (r.code !== 0 || parsed.error) {
    throw new AppError('E_FORMAT', '動画を開けませんでした。破損しているか、対応していない形式です。', {
      nextAction: '別の動画を選ぶか、元の撮影ファイルを使ってください。',
      detail: maskPaths(parsed.error?.string ?? r.stderrTail)
    });
  }
  return parsed;
}

export interface PacketScan {
  /** discard でない最初の表示 PTS(µs) */
  firstPtsUs: number;
  /** max(pts + duration)(µs) */
  endUs: number;
  count: number;
  isVfr: boolean;
}

/** 映像パケットを全走査して PTS の最小/最大と VFR を確定する。 */
export async function scanVideoPackets(tools: MediaTools, file: string, streamIndex: number, tb: { num: number; den: number }, expectedCount: number | null, onProgress?: (p: ProbeProgress) => void, signal?: AbortSignal): Promise<PacketScan> {
  let minPts: bigint | null = null;
  let maxEnd: bigint | null = null;
  let count = 0;
  const ptsList: bigint[] = [];
  let lastReport = 0;
  const r = await runTool(tools.ffprobe, {
    args: ['-v', 'error', '-select_streams', String(streamIndex), '-show_entries', 'packet=pts,duration,flags', '-of', 'csv=p=0', file],
    timeoutMs: 20 * 60_000,
    stallTimeoutMs: 120_000,
    ...(signal ? { signal } : {}),
    onStdoutLine: (line) => {
      if (!line) return;
      const [ptsS, durS, flags] = line.split(',');
      if (!ptsS || ptsS === 'N/A') return;
      if (flags && flags.includes('D')) return; // discard (edit list 前のフレーム)
      let pts: bigint;
      try {
        pts = BigInt(ptsS);
      } catch {
        return;
      }
      count++;
      ptsList.push(pts);
      const dur = durS && durS !== 'N/A' ? BigInt(durS) : 0n;
      if (minPts === null || pts < minPts) minPts = pts;
      const end = pts + dur;
      if (maxEnd === null || end > maxEnd) maxEnd = end;
      const now = Date.now();
      if (onProgress && now - lastReport > 200) {
        lastReport = now;
        onProgress({ stage: '映像フレームの時刻を確認中', ratio: expectedCount ? Math.min(0.99, count / expectedCount) : null });
      }
    }
  });
  if (r.cancelled) throw new AppError('E_CANCELLED', 'キャンセルしました。');
  if (r.code !== 0 || minPts === null || maxEnd === null || count === 0) {
    throw new AppError('E_FORMAT', '映像フレームの時刻情報を読み取れませんでした。', { nextAction: '別の動画を選び直してください。', detail: maskPaths(r.stderrTail) });
  }
  const sorted = ptsList.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const deltas: bigint[] = [];
  for (let i = 1; i < sorted.length; i++) deltas.push((sorted[i] as bigint) - (sorted[i - 1] as bigint));
  deltas.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const medianDelta = deltas.length ? (deltas[Math.floor(deltas.length / 2)] as bigint) : 0n;
  const lastSorted = sorted[sorted.length - 1] as bigint;
  if (maxEnd <= lastSorted) maxEnd = lastSorted + medianDelta;
  let isVfr = false;
  if (deltas.length > 2 && medianDelta > 0n) {
    const tol = medianDelta / 10n + 1n;
    const dmin = deltas[0] as bigint;
    const dmax = deltas[deltas.length - 1] as bigint;
    isVfr = medianDelta - dmin > tol || dmax - medianDelta > tol;
  }
  return { firstPtsUs: tbToUs(minPts, tb), endUs: tbToUs(maxEnd, tb), count, isVfr };
}

/** 最初にデコードされる映像フレームの best_effort_timestamp(µs)。先頭 1.5 秒分のパケットを読む。 */
export async function probeFirstDecodedFrameUs(tools: MediaTools, file: string, streamIndex: number, tb: { num: number; den: number }, signal?: AbortSignal): Promise<number | null> {
  const r = await runTool(tools.ffprobe, {
    args: ['-v', 'error', '-select_streams', String(streamIndex), '-show_entries', 'frame=best_effort_timestamp,pts', '-read_intervals', '%+1.5', '-of', 'csv=p=0', file],
    timeoutMs: 120_000,
    ...(signal ? { signal } : {})
  });
  if (r.cancelled) throw new AppError('E_CANCELLED', 'キャンセルしました。');
  if (r.code !== 0) return null;
  let min: bigint | null = null;
  for (const line of r.stdoutText.split('\n')) {
    const [best, pts] = line.trim().split(',');
    const v = best && best !== 'N/A' ? best : pts && pts !== 'N/A' ? pts : null;
    if (!v) continue;
    try {
      const b = BigInt(v);
      if (min === null || b < min) min = b;
    } catch {
      /* ignore */
    }
  }
  return min === null ? null : tbToUs(min, tb);
}

export function selectVideoStream(json: ProbeJson): Stream {
  const videos = (json.streams ?? []).filter((s) => s.codec_type === 'video' && !(s.disposition?.['attached_pic'] === 1));
  if (videos.length === 0) throw new AppError('E_FORMAT', '映像トラックが見つかりません。', { nextAction: '映像を含む MP4/MOV を選んでください。' });
  if (videos.length > 1) throw new AppError('E_FORMAT', '映像トラックが複数あります。この版では映像 1 本の動画だけに対応しています。', { nextAction: '映像トラックが 1 本の動画を選んでください。' });
  return videos[0] as Stream;
}

export function listAudioTracks(json: ProbeJson): AudioTrackInfo[] {
  return (json.streams ?? [])
    .filter((s) => s.codec_type === 'audio')
    .map((s) => ({
      streamIndex: s.index,
      codec: s.codec_name ?? 'unknown',
      sampleRate: s.sample_rate ?? 0,
      channels: s.channels ?? 0,
      channelLayout: s.channel_layout ?? '',
      isDefault: s.disposition?.['default'] === 1,
      language: s.tags?.['language'] ?? null,
      title: s.tags?.['title'] ?? displayHandlerName(s.tags?.['handler_name']),
      startTimeUs: s.start_time !== undefined && Number.isFinite(s.start_time) ? Math.round(s.start_time * 1_000_000) : null,
      durationUs: s.duration !== undefined && Number.isFinite(s.duration) ? Math.round(s.duration * 1_000_000) : null
    }));
}

/** MP4 ではストリーム名が handler_name に入る。ffmpeg 既定の名前は表示しない。 */
function displayHandlerName(name: string | undefined): string | null {
  if (!name) return null;
  if (/^(SoundHandler|VideoHandler|Core Media Audio|Core Media Video|ISO Media file produced by Google Inc\.?|Mainconcept.*|L-SMASH.*)$/i.test(name.trim())) return null;
  return name.trim().slice(0, 80);
}

/** 既定の音声トラック: 最初の default、無ければ最初。 */
export function defaultAudioTrack(tracks: AudioTrackInfo[]): AudioTrackInfo | null {
  return tracks.find((t) => t.isDefault) ?? tracks[0] ?? null;
}

const SUPPORTED_AUDIO_CODECS = /^(aac|pcm_[a-z0-9_]+|alac)$/;

export function validateAudioTrack(t: AudioTrackInfo): void {
  if (!SUPPORTED_AUDIO_CODECS.test(t.codec)) {
    throw new AppError('E_FORMAT', `音声の形式(${t.codec})に対応していません。`, { nextAction: 'AAC または PCM の音声を持つ動画を選んでください。' });
  }
  if (t.channels < 1 || t.channels > 2) {
    throw new AppError('E_FORMAT', `音声のチャンネル数(${t.channels})に対応していません。モノラル/ステレオのみ対応です。`, { nextAction: 'モノラルまたはステレオ音声の動画を選んでください。' });
  }
  if (!(t.sampleRate > 0)) throw new AppError('E_FORMAT', '音声のサンプルレートを読み取れませんでした。');
}

export interface ProbeOptions {
  onProgress?: (p: ProbeProgress) => void;
  signal?: AbortSignal;
}

/** 素材全体を検査して SourceInfo を返す。音声トラックの選択は呼び出し側。 */
export async function probeSource(tools: MediaTools, file: string, opts: ProbeOptions = {}): Promise<SourceInfo> {
  const st = await stat(file);
  if (!st.isFile()) throw new AppError('E_FORMAT', '通常のファイルではありません。', { nextAction: 'ディレクトリやプレイリストではなく動画ファイルを選んでください。' });
  if (st.size > MAX_SOURCE_BYTES) {
    throw new AppError('E_TOO_LARGE', 'ファイルサイズが上限(4GiB)を超えています。', { nextAction: '4GiB 以内の動画を選んでください。' });
  }
  opts.onProgress?.({ stage: '動画の情報を確認中', ratio: null });
  const json = await probeContainer(tools, file, opts.signal);
  const formatName = json.format?.format_name ?? '';
  const isMp4Family = formatName.split(',').some((n) => ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'].includes(n.trim()));
  if (!isMp4Family) {
    throw new AppError('E_FORMAT', `コンテナ形式(${formatName || '不明'})に対応していません。`, { nextAction: 'MP4 または MOV の動画を選んでください。拡張子ではなく中身で判定しています。' });
  }
  const v = selectVideoStream(json);
  const warnings: string[] = [];
  const codec = v.codec_name ?? '';
  if (codec !== 'h264' && codec !== 'hevc') {
    throw new AppError('E_FORMAT', `映像コーデック(${codec || '不明'})に対応していません。`, { nextAction: 'H.264 または HEVC の動画を選んでください。' });
  }
  if ((v.codec_tag_string ?? '').toLowerCase().startsWith('enc')) {
    throw new AppError('E_FORMAT', '暗号化された動画には対応していません。', { nextAction: '暗号化されていない動画を選んでください。' });
  }
  const pixFmt = v.pix_fmt ?? '';
  const bits = v.bits_per_raw_sample ?? 8;
  if (/p1[0246]/.test(pixFmt) || bits > 8) {
    throw new AppError('E_FORMAT', `10bit 以上の映像(${pixFmt})には対応していません。`, { nextAction: '8bit SDR の動画を選んでください。' });
  }
  if (!/^(yuv420p|yuvj420p|nv12|yuv422p|yuvj422p|yuv444p)$/.test(pixFmt)) {
    throw new AppError('E_FORMAT', `ピクセル形式(${pixFmt || '不明'})には対応していません。`, { nextAction: '一般的な 8bit の動画を選んでください。' });
  }
  const fieldOrder = v.field_order ?? 'unknown';
  if (!['progressive', 'unknown'].includes(fieldOrder)) {
    throw new AppError('E_FORMAT', 'インターレース映像には対応していません。', { nextAction: 'プログレッシブの動画を選んでください。' });
  }
  const transfer = v.color_transfer ?? null;
  if (transfer === 'smpte2084' || transfer === 'arib-std-b67') {
    throw new AppError('E_FORMAT', 'HDR(PQ/HLG)の映像には対応していません。', { nextAction: 'SDR の動画を選ぶか、撮影側の設定を SDR にしてください。' });
  }
  if (hasSideData(v, 'dovi') || hasSideData(v, 'dolby')) {
    throw new AppError('E_FORMAT', 'Dolby Vision の映像には対応していません。', { nextAction: 'SDR の動画を選んでください。' });
  }
  const codedWidth = v.width ?? v.coded_width ?? 0;
  const codedHeight = v.height ?? v.coded_height ?? 0;
  if (codedWidth <= 0 || codedHeight <= 0) throw new AppError('E_FORMAT', '映像サイズを読み取れませんでした。');
  const sar = parseRational(v.sample_aspect_ratio) ?? { num: 1, den: 1 };
  const sarNum = sar.num > 0 ? sar.num : 1;
  const sarDen = sar.den > 0 ? sar.den : 1;
  const rotation = rotationOf(v);
  let dispW = Math.round((codedWidth * sarNum) / sarDen);
  let dispH = codedHeight;
  if (rotation === 90 || rotation === 270) [dispW, dispH] = [dispH, dispW];
  const longSide = Math.max(dispW, dispH);
  const shortSide = Math.min(dispW, dispH);
  if (longSide > MAX_LONG_SIDE || shortSide > MAX_SHORT_SIDE) {
    throw new AppError('E_TOO_BIG_FRAME', `映像サイズ(${dispW}×${dispH})が上限(長辺1920/短辺1080)を超えています。`, { nextAction: '1080p 相当以下の動画を選んでください。4K には対応していません。' });
  }
  const tb = parseRational(v.time_base);
  if (!tb) throw new AppError('E_FORMAT', '映像の時間基準を読み取れませんでした。');
  const fr = parseRational(v.r_frame_rate) ?? parseRational(v.avg_frame_rate);
  if (!fr || fr.num <= 0) throw new AppError('E_FORMAT', '映像のフレームレートを読み取れませんでした。');
  const fps = fr.num / fr.den;
  if (fps < 23 || fps > 61) {
    throw new AppError('E_FORMAT', `フレームレート(${fps.toFixed(2)}fps)には対応していません。`, { nextAction: '25/29.97/30/50/59.94/60fps の動画を選んでください。' });
  }
  const approxDuration = v.duration ?? json.format?.duration ?? null;
  if (approxDuration !== null && Number.isFinite(approxDuration) && approxDuration > MAX_SOURCE_DURATION_SECONDS + 1) {
    throw new AppError('E_TOO_LONG', '動画が 30 分の上限を超えています。', { nextAction: '30 分以内の動画を選んでください。' });
  }
  const expectedCount = approxDuration !== null && Number.isFinite(approxDuration) ? Math.round(approxDuration * fps) : null;
  const scan = await scanVideoPackets(tools, file, v.index, tb, expectedCount, opts.onProgress, opts.signal);
  opts.onProgress?.({ stage: '最初のフレームを確認中', ratio: null });
  const firstFrameUs = await probeFirstDecodedFrameUs(tools, file, v.index, tb, opts.signal);
  let t0 = scan.firstPtsUs;
  if (firstFrameUs !== null) {
    if (Math.abs(firstFrameUs - scan.firstPtsUs) > 1_000_000 / fps) {
      warnings.push('最初に表示されるフレームの時刻がパケット情報と異なるため、デコード結果の時刻を採用しました。');
    }
    t0 = firstFrameUs;
  }
  const durationUs = scan.endUs - t0;
  if (!Number.isFinite(durationUs) || durationUs <= 0) {
    throw new AppError('E_FORMAT', '動画の長さが 0 または不正です。', { nextAction: '別の動画を選び直してください。' });
  }
  if (durationUs > MAX_SOURCE_DURATION_SECONDS * 1_000_000) {
    throw new AppError('E_TOO_LONG', '動画が 30 分の上限を超えています。', { nextAction: '30 分以内の動画を選んでください。' });
  }
  const totalFrames = durationUsToFrameCount(durationUs);
  const audioTracks = listAudioTracks(json);
  if (audioTracks.length === 0) {
    throw new AppError('E_NO_AUDIO', 'この動画には音声がありません。', { nextAction: '音声付きの動画を選び直してください。無音の判定には音声トラックが必要です。' });
  }
  const colorInfo: ColorInfo = {
    range: v.color_range ?? null,
    space: v.color_space ?? null,
    transfer,
    primaries: v.color_primaries ?? null,
    pixFmt,
    assumedBt709: !v.color_space && !v.color_primaries && !transfer
  };
  if (colorInfo.assumedBt709) warnings.push('色の情報が記録されていないため、SDR BT.709 として処理します。色の再現は保証されません。');
  if (codec === 'hevc') warnings.push('HEVC の動画は H.264 への変換に時間がかかります。');
  if (scan.isVfr) warnings.push('可変フレームレートの録画です。30fps の固定フレームレートへ変換します。');
  return {
    basename: path.basename(file),
    sizeBytes: st.size,
    mtimeMs: Math.round(st.mtimeMs),
    container: formatName,
    videoStreamIndex: v.index,
    codec,
    profile: v.profile ?? null,
    codedWidth,
    codedHeight,
    sarNum,
    sarDen,
    rotation,
    displayWidth: dispW,
    displayHeight: dispH,
    frameRateNum: fr.num,
    frameRateDen: fr.den,
    isVfr: scan.isVfr,
    firstVideoPtsUs: t0,
    durationUs,
    totalFrames,
    videoPacketCount: scan.count,
    audioTracks,
    colorInfo,
    warnings
  };
}

/** 色変換計画(scale フィルタ用)。 */
export function colorPlanFor(info: ColorInfo): { inMatrix: string | null; inRange: 'tv' | 'pc' | null } {
  const matrixMap: Record<string, string> = { bt709: 'bt709', smpte170m: 'smpte170m', bt470bg: 'bt470bg', bt601: 'smpte170m', fcc: 'fcc', smpte240m: 'smpte240m', bt2020nc: 'bt2020' };
  const inMatrix = info.space ? (matrixMap[info.space] ?? null) : null;
  const inRange = info.range === 'pc' || info.pixFmt.startsWith('yuvj') ? 'pc' : info.range === 'tv' ? 'tv' : null;
  return { inMatrix, inRange };
}
