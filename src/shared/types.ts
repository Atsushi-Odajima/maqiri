// main / renderer / media で共有する型。レンダラーには絶対パスを渡さない(basename のみ)。
import type { OutputPresetId } from './constants';
import type { AnalysisSettings } from '@domain/settings';
import type { FrameRange } from '@domain/ranges';
import type { AppErrorShape } from './errors';

export type Edition = 'demo' | 'full';

export interface AudioTrackInfo {
  streamIndex: number;
  codec: string;
  sampleRate: number;
  channels: number;
  channelLayout: string;
  isDefault: boolean;
  language: string | null;
  title: string | null;
  startTimeUs: number | null;
  durationUs: number | null;
}

export interface ColorInfo {
  range: string | null;
  space: string | null;
  transfer: string | null;
  primaries: string | null;
  pixFmt: string;
  /** タグ不明のため SDR BT.709 として処理した */
  assumedBt709: boolean;
}

export interface SourceInfo {
  basename: string;
  sizeBytes: number;
  mtimeMs: number;
  container: string;
  videoStreamIndex: number;
  codec: string;
  profile: string | null;
  codedWidth: number;
  codedHeight: number;
  sarNum: number;
  sarDen: number;
  rotation: 0 | 90 | 180 | 270;
  displayWidth: number;
  displayHeight: number;
  frameRateNum: number;
  frameRateDen: number;
  isVfr: boolean;
  /** T0: 最初に表示される映像フレームの PTS(µs, 元ファイルのタイムライン) */
  firstVideoPtsUs: number;
  /** D: 正規化後の映像長(µs) */
  durationUs: number;
  /** N = ceil(D*30) */
  totalFrames: number;
  videoPacketCount: number;
  audioTracks: AudioTrackInfo[];
  colorInfo: ColorInfo;
  warnings: string[];
}

export interface SelectedSource extends SourceInfo {
  assetId: string;
  sha256: string;
  audioStreamIndex: number;
  /** 選択音声トラックのチャンネル数 */
  channels: number;
  sampleRate: number;
  audioCodec: string;
  /** DEMO: 解析/選択できる最大フレーム(元時刻)。FULL は totalFrames と同じ。 */
  limitFrames: number;
}

export interface AnalysisWindows {
  /** 20ms 窓ごとの dBFS(max channel RMS)。Float32Array を転送。 */
  windowDb: Float32Array;
  windowMs: number;
  /** 解析対象のフレーム数(limitFrames) */
  analyzedFrames: number;
  algorithmVersion: string;
}

export type JobKind = 'probe' | 'hash' | 'analysis' | 'preview' | 'export' | 'selftest';

export interface JobProgress {
  jobId: string;
  kind: JobKind;
  /** 段階名(日本語) */
  stage: string;
  /** 0..1、不明なら null */
  ratio: number | null;
  detail?: string;
}

export interface JobFailure {
  jobId: string;
  error: AppErrorShape;
}

export interface ExportRequest {
  projectId: string;
  revision: number;
  settings: AnalysisSettings;
  cutRanges: FrameRange[];
  outputPreset: OutputPresetId;
  /** 確認済み保存先トークン(main が選択ダイアログで発行) */
  destinationToken: string;
  includeUnreviewed: boolean;
}

export interface ExportReport {
  outputBasename: string;
  outputSizeBytes: number;
  outputFrames: number;
  outputDurationUs: number;
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  encoderName: string;
  encoderSettings: string;
  audioBitrateKbps: number;
  videoBitrateKbps: number;
  verification: {
    videoFrameCount: { expected: number; actual: number; ok: boolean };
    audioDurationMs: { expected: number; actual: number; diffMs: number; ok: boolean };
    avEndDiffMs: { diffMs: number; ok: boolean };
  };
  elapsedMs: number;
  exportedAt: string;
}

export interface EncoderStatus {
  ok: boolean;
  encoderName: string;
  variant: string;
  message: string;
  detail?: string;
  checkedAt: string;
  toolsKind: 'bundled-win32' | 'system-dev';
  ffmpegVersion: string;
}

export interface RecentProjectEntry {
  projectId: string;
  title: string;
  sourceBasename: string;
  updatedAt: string;
  /** プロジェクトファイルの basename(絶対パスは main が保持) */
  projectBasename: string;
}

export interface DestinationInfo {
  destinationToken: string;
  basename: string;
  folderDisplay: string;
  freeBytes: number;
  requiredBytes: number;
  willOverwrite: boolean;
}

export interface JunctionPreview {
  /** 候補 id と revision */
  candidateId: string;
  revision: number;
  /** 前後 2 秒を含むコンテキストの元フレーム範囲 */
  contextStartFrame: number;
  contextEndFrame: number;
  cut: FrameRange;
  /** maqiri-media://cache/<id> で再生できる */
  originalMediaUrl: string;
  editedMediaUrl: string;
}
