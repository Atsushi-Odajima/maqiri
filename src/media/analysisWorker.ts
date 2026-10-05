// worker_threads: ffmpeg から f32le PCM をストリームで受け取り、20ms 窓ごとの RMS(dBFS) を計算する。
// レンダラーへ生 PCM を渡さない。結果は Float32Array(窓ごとの dB)。
import { parentPort, workerData } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { ANALYSIS_WINDOW_SAMPLES, OUTPUT_SAMPLE_RATE, SAMPLES_PER_FRAME } from '@shared/constants';
import { combineChannelRms, rmsToDbfs } from '@domain/rms';

export interface AnalysisWorkerData {
  ffmpeg: string;
  file: string;
  audioStreamIndex: number;
  channels: number;
  t0Us: number;
  /** 解析するフレーム数(DEMO では 2700 まで) */
  limitFrames: number;
}

export type AnalysisWorkerMessage =
  | { type: 'progress'; ratio: number }
  | { type: 'done'; windowDb: Float32Array; windowCount: number }
  | { type: 'error'; message: string; stderr: string }
  | { type: 'cancelled' };

const data = workerData as AnalysisWorkerData;

function main(): void {
  const port = parentPort;
  if (!port) return;
  const totalSamples = data.limitFrames * SAMPLES_PER_FRAME;
  const windowCount = Math.ceil(totalSamples / ANALYSIS_WINDOW_SAMPLES);
  const windowDb = new Float32Array(windowCount);
  const channels = data.channels;
  const t0 = data.t0Us >= 0 ? `PTS-${data.t0Us}/1000000/TB` : `PTS+${-data.t0Us}/1000000/TB`;
  // 解析と書き出しは同じ正規化(T0, 48kHz, first_pts=0, N*1600 への pad/trim)を使う。
  const af = [`asetpts=${t0}`, `aresample=${OUTPUT_SAMPLE_RATE}:async=1:first_pts=0`, `apad=whole_len=${totalSamples}`, `atrim=end_sample=${totalSamples}`].join(',');
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file', '-i', data.file, '-map', `0:${data.audioStreamIndex}`, '-vn', '-sn', '-dn', '-af', af, '-ac', String(channels), '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1'];
  const child = spawn(data.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
  let stderr = '';
  let cancelled = false;
  const bytesPerFrame = 4 * channels;
  let rest = Buffer.alloc(0);
  let sampleIndex = 0; // 消費済みサンプル(フレーム)数
  const sums = new Float64Array(channels);
  let winFill = 0;
  let winIndex = 0;
  let lastProgress = 0;

  const flushWindow = () => {
    if (winIndex >= windowCount) return;
    const rms: number[] = [];
    for (let c = 0; c < channels; c++) rms.push(Math.sqrt((sums[c] ?? 0) / Math.max(1, winFill)));
    windowDb[winIndex] = rmsToDbfs(combineChannelRms(rms));
    winIndex++;
    sums.fill(0);
    winFill = 0;
  };

  child.stdout.on('data', (chunk: Buffer) => {
    if (cancelled) return;
    const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    const usable = buf.length - (buf.length % bytesPerFrame);
    const frames = usable / bytesPerFrame;
    const f32 = new Float32Array(buf.buffer, buf.byteOffset, usable / 4);
    for (let i = 0; i < frames; i++) {
      if (sampleIndex >= totalSamples) break;
      const base = i * channels;
      for (let c = 0; c < channels; c++) {
        const s = f32[base + c] ?? 0;
        sums[c] = (sums[c] ?? 0) + s * s;
      }
      winFill++;
      sampleIndex++;
      if (winFill === ANALYSIS_WINDOW_SAMPLES) flushWindow();
    }
    rest = usable < buf.length ? Buffer.from(buf.subarray(usable)) : Buffer.alloc(0);
    const now = Date.now();
    if (now - lastProgress > 250) {
      lastProgress = now;
      port.postMessage({ type: 'progress', ratio: Math.min(0.99, sampleIndex / totalSamples) } satisfies AnalysisWorkerMessage);
    }
  });
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString('utf8');
    if (stderr.length > 32 * 1024) stderr = stderr.slice(-32 * 1024);
  });
  child.on('error', (e) => {
    port.postMessage({ type: 'error', message: e.message, stderr } satisfies AnalysisWorkerMessage);
  });
  child.on('close', (code) => {
    if (cancelled) {
      port.postMessage({ type: 'cancelled' } satisfies AnalysisWorkerMessage);
      return;
    }
    if (code !== 0) {
      port.postMessage({ type: 'error', message: `ffmpeg exited ${code}`, stderr } satisfies AnalysisWorkerMessage);
      return;
    }
    if (winFill > 0) flushWindow();
    // 不足分(理論上 apad で埋まるが保険)は無音
    while (winIndex < windowCount) {
      windowDb[winIndex] = rmsToDbfs(0);
      winIndex++;
    }
    port.postMessage({ type: 'done', windowDb, windowCount } satisfies AnalysisWorkerMessage, [windowDb.buffer]);
  });
  port.on('message', (m: { type: string }) => {
    if (m.type === 'cancel') {
      cancelled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  });
}

main();
