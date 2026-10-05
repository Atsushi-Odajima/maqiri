// 時刻の正本に関する定数。レンダラー/メイン/ドメインで共有する。
export const OUTPUT_FPS = 30;
export const OUTPUT_SAMPLE_RATE = 48_000;
export const SAMPLES_PER_FRAME = OUTPUT_SAMPLE_RATE / OUTPUT_FPS; // 1600
export const ANALYSIS_WINDOW_MS = 20;
export const ANALYSIS_WINDOW_SAMPLES = (OUTPUT_SAMPLE_RATE * ANALYSIS_WINDOW_MS) / 1000; // 960
export const ALGORITHM_VERSION = 'rms20-v1';
export const DB_FLOOR = -160;
export const MIN_CUT_FRAMES = 3;
export const MIN_REMOVAL_MS = 100;
export const MAX_CANDIDATES = 600;
export const ALL_QUIET_RATIO = 0.95;
export const MIN_REMAINING_SECONDS = 1;

export const MAX_SOURCE_DURATION_SECONDS = 30 * 60;
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB
export const MAX_LONG_SIDE = 1920;
export const MAX_SHORT_SIDE = 1080;
export const DEMO_SECONDS = 90;
export const DEMO_MAX_FRAMES = DEMO_SECONDS * OUTPUT_FPS; // 2700

export const UNDO_LIMIT = 100;
export const CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const AUTOSAVE_DEBOUNCE_MS = 1000;
export const JUNCTION_CONTEXT_SECONDS = 2;

export const SETTINGS_LIMITS = {
  thresholdDb: { min: -60, max: -15, step: 1, default: -35 },
  minSilenceMs: { min: 400, max: 3000, step: 50, default: 800 },
  padBeforeMs: { min: 80, max: 600, step: 10, default: 150 },
  padAfterMs: { min: 80, max: 600, step: 10, default: 150 }
} as const;

export type PresetId = 'natural' | 'relaxed' | 'short';
export const PRESETS: Record<PresetId, { label: string; thresholdDb: number; minSilenceMs: number; padBeforeMs: number; padAfterMs: number; note: string }> = {
  natural: { label: '自然に', thresholdDb: -35, minSilenceMs: 800, padBeforeMs: 150, padAfterMs: 150, note: '話の間を少し残します。' },
  relaxed: { label: 'ゆったり', thresholdDb: -38, minSilenceMs: 1200, padBeforeMs: 250, padAfterMs: 250, note: '小さい声も残し、長い間だけを詰めます。' },
  short: { label: '短く', thresholdDb: -32, minSilenceMs: 600, padBeforeMs: 100, padAfterMs: 100, note: '語尾が切れやすくなります。つなぎ目を確認してください。' }
};

export const OUTPUT_PRESETS = {
  '1080p30': { label: '1080p / 30fps', maxLong: 1920, maxShort: 1080, videoBitrateKbps: 12_000, maxrateKbps: 15_000 },
  '720p30': { label: '720p / 30fps', maxLong: 1280, maxShort: 720, videoBitrateKbps: 6_000, maxrateKbps: 8_000 }
} as const;
export type OutputPresetId = keyof typeof OUTPUT_PRESETS;

export const AUDIO_BITRATE_KBPS = { mono: 128, stereo: 192 } as const;

export const EXPORT_TOLERANCE = {
  audioDurationMs: 48,
  avEndDiffMs: 50,
  markerFrames: 1
} as const;
