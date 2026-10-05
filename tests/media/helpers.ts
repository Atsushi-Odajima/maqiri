import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTools, type MediaTools } from '@media/tools';
import { OUTPUT_FPS, SAMPLES_PER_FRAME } from '@shared/constants';
import type { FrameRange } from '@domain/ranges';

export const root = path.resolve(__dirname, '..', '..');
export const fixturesDir = path.join(root, 'tests', 'fixtures', 'generated');
export const workDir = path.join(root, 'tests', '.build', 'media-out');
export const workerPath = path.join(root, 'tests', '.build', 'analysis-worker.cjs');

export interface FixtureEntry {
  file: string;
  width: number;
  height: number;
  fps: string;
  durationSeconds: number;
  channels: number;
  speech: Array<[number, number, number]>;
  quietDb: number | null;
  markers: number[];
  encoder: string;
  displayRotation: number;
  audioOffset: number;
  videoOffset: number;
  audioDur: number;
  negativeTs: number;
  channelMode: string;
  vfr: boolean;
  extraSilentTrackFirst: boolean;
  container: string;
  colorTags: string;
  corrupt?: boolean;
}

export function loadManifest(): Record<string, FixtureEntry> {
  return JSON.parse(readFileSync(path.join(fixturesDir, 'manifest.json'), 'utf8')).fixtures as Record<string, FixtureEntry>;
}

export function fixturePath(name: string): string {
  const m = loadManifest();
  const e = m[name];
  if (!e) throw new Error(`fixture ${name} not in manifest`);
  return path.join(fixturesDir, e.file);
}

export function tools(): MediaTools {
  return resolveTools(path.join(root, 'resources', 'media-tools'));
}

export function ensureWorkDir(): string {
  mkdirSync(workDir, { recursive: true });
  return workDir;
}

/** 期待される quiet run(ms)。speech 区間の補集合(20ms 窓の格子に揃う)。 */
export function expectedQuietRunsMs(entry: FixtureEntry, totalMs: number): Array<{ startMs: number; endMs: number }> {
  const runs: Array<{ startMs: number; endMs: number }> = [];
  const speech = [...entry.speech].sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [s, e] of speech) {
    const sMs = Math.round(s * 1000);
    const eMs = Math.round(e * 1000);
    if (sMs > cursor) runs.push({ startMs: cursor, endMs: sMs });
    cursor = Math.max(cursor, eMs);
  }
  if (cursor < totalMs) runs.push({ startMs: cursor, endMs: totalMs });
  return runs;
}

/** 出力動画の白フレーム(マーカー)のフレーム番号を signalstats の YAVG で検出する。 */
export function detectBrightFrames(t: MediaTools, file: string): number[] {
  const r = spawnSync(t.ffmpeg, ['-hide_banner', '-loglevel', 'info', '-i', file, '-map', '0:v', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // 連続する白フレーム(VFR→CFR 変換で複製されたマーカー)は 1 つの onset として数える
  const bright: number[] = [];
  let frame = -1;
  let prevBright = -10;
  for (const line of r.stdout.split('\n')) {
    const f = /^frame:(\d+)/.exec(line);
    if (f) frame = Number(f[1]);
    const y = /YAVG=([\d.]+)/.exec(line);
    if (y && Number(y[1]) > 180 && frame >= 0) {
      if (frame !== prevBright + 1) bright.push(frame);
      prevBright = frame;
    }
  }
  return bright;
}

/** 出力音声を f32le で読み、1600 サンプルごとの RMS が閾値を超える最初のフレーム(ビープ開始)を返す。 */
export function detectBeepOnsets(t: MediaTools, file: string, minGapFrames = 15): number[] {
  const r = spawnSync(t.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a', '-ac', '1', '-ar', '48000', '-af', 'highpass=f=700,lowpass=f=1300', '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1'], { maxBuffer: 512 * 1024 * 1024 });
  const buf = r.stdout as Buffer;
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const onsets: number[] = [];
  let lastOnset = -Infinity;
  let prevLoud = false;
  const frames = Math.floor(f32.length / SAMPLES_PER_FRAME);
  for (let n = 0; n < frames; n++) {
    let sum = 0;
    for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
      const v = f32[n * SAMPLES_PER_FRAME + i] ?? 0;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / SAMPLES_PER_FRAME);
    const loud = rms > 0.12; // ビープ振幅 0.5 → RMS 0.35。ノイズ -20dBFS はバンドパス後 0.03 程度
    if (loud && !prevLoud && n - lastOnset > minGapFrames) {
      onsets.push(n);
      lastOnset = n;
    }
    prevLoud = loud;
  }
  return onsets;
}

/** 元フレーム番号 → 出力フレーム番号(削除区間内なら null)。 */
export function mapToOutputFrame(frame: number, cuts: FrameRange[]): number | null {
  let removed = 0;
  for (const c of cuts) {
    if (frame >= c.startFrame && frame < c.endFrame) return null;
    if (c.endFrame <= frame) removed += c.endFrame - c.startFrame;
  }
  return frame - removed;
}

export function secondsToFrame(sec: number): number {
  return Math.round(sec * OUTPUT_FPS);
}

export function hasFixture(name: string): boolean {
  const m = loadManifest();
  return !!m[name] && existsSync(path.join(fixturesDir, m[name]!.file));
}
