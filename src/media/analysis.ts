// 解析ワーカーのホスト側。worker_threads を起動し、進捗・結果・キャンセルを扱う。
import { Worker } from 'node:worker_threads';
import { AppError } from '@shared/errors';
import { ALGORITHM_VERSION, ANALYSIS_WINDOW_MS } from '@shared/constants';
import type { AnalysisWindows } from '@shared/types';
import type { AnalysisWorkerData, AnalysisWorkerMessage } from './analysisWorker';
import { maskPaths } from './process';

export interface RunAnalysisOptions {
  workerPath: string;
  data: AnalysisWorkerData;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function runAnalysis(opts: RunAnalysisOptions): Promise<AnalysisWindows> {
  return new Promise<AnalysisWindows>((resolve, reject) => {
    const worker = new Worker(opts.workerPath, { workerData: opts.data });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.postMessage({ type: 'cancel' });
      void worker.terminate();
      reject(new AppError('E_READ', '音量の解析が時間内に終わりませんでした。', { nextAction: 'もう一度試すか、短い動画で確認してください。' }));
    }, opts.timeoutMs ?? 30 * 60_000);
    const onAbort = () => {
      worker.postMessage({ type: 'cancel' });
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const finish = () => {
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', onAbort);
    };
    worker.on('message', (m: AnalysisWorkerMessage) => {
      if (m.type === 'progress') {
        opts.onProgress?.(m.ratio);
      } else if (m.type === 'done') {
        if (settled) return;
        settled = true;
        finish();
        resolve({ windowDb: m.windowDb, windowMs: ANALYSIS_WINDOW_MS, analyzedFrames: opts.data.limitFrames, algorithmVersion: ALGORITHM_VERSION });
        void worker.terminate();
      } else if (m.type === 'cancelled') {
        if (settled) return;
        settled = true;
        finish();
        reject(new AppError('E_CANCELLED', 'キャンセルしました。'));
        void worker.terminate();
      } else if (m.type === 'error') {
        if (settled) return;
        settled = true;
        finish();
        reject(new AppError('E_READ', '音声を読み取れませんでした。', { nextAction: '別の音声トラックを選ぶか、動画を選び直してください。', detail: maskPaths(`${m.message}\n${m.stderr}`) }));
        void worker.terminate();
      }
    });
    worker.on('error', (e) => {
      if (settled) return;
      settled = true;
      finish();
      reject(new AppError('E_INTERNAL', '解析処理で問題が起きました。', { detail: e.message }));
    });
    worker.on('exit', (code) => {
      if (settled) return;
      settled = true;
      finish();
      reject(new AppError('E_INTERNAL', `解析処理が予期せず終了しました(code ${code})。`));
    });
  });
}
