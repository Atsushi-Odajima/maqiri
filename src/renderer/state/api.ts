// レンダラー側 IPC ラッパー。preload が公開する window.maqiri だけを使う。
import type { IpcChannel, IpcPayload } from '@shared/schemas';
import type { IpcResult, JobResultMap, MainEvent } from '@shared/ipc';
import type { JobKind, JobProgress } from '@shared/types';
import { isAppErrorShape, type AppErrorShape } from '@shared/errors';

export function parseIpcError(e: unknown): AppErrorShape {
  const msg = e instanceof Error ? e.message : String(e);
  // Electron は invoke のエラーを "Error invoking remote method 'x': Error: {...}" に包む
  const idx = msg.indexOf('{');
  if (idx >= 0) {
    try {
      const parsed = JSON.parse(msg.slice(idx)) as unknown;
      if (isAppErrorShape(parsed)) return parsed;
    } catch {
      /* fallthrough */
    }
  }
  return { code: 'E_INTERNAL', message: '処理中に予期しないエラーが発生しました。', detail: msg };
}

export async function invoke<C extends IpcChannel>(channel: C, payload: IpcPayload<C>): Promise<IpcResult<C>> {
  try {
    return await window.maqiri.invoke(channel, payload);
  } catch (e) {
    throw parseIpcError(e);
  }
}

type Listener = (ev: MainEvent) => void;
const listeners = new Set<Listener>();
let unsubscribe: (() => void) | null = null;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!unsubscribe) {
    unsubscribe = window.maqiri.onEvent((ev) => {
      for (const l of [...listeners]) l(ev);
    });
  }
  return () => listeners.delete(listener);
}

export interface JobHandle<K extends JobKind> {
  jobId: string;
  result: Promise<JobResultMap[K]>;
  cancel: () => Promise<void>;
}

/** ジョブ開始チャンネルを呼び、job:done/job:failed を待つ。進捗は onProgress へ。 */
export async function runJob<K extends JobKind, C extends IpcChannel>(_kind: K, channel: C, payload: IpcPayload<C>, onProgress?: (p: JobProgress) => void): Promise<JobHandle<K>> {
  const started = (await invoke(channel, payload)) as { jobId: string };
  const jobId = started.jobId;
  let settled = false;
  const result = new Promise<JobResultMap[K]>((resolve, reject) => {
    const off = subscribe((ev) => {
      if (ev.type === 'job:progress' && ev.progress.jobId === jobId) onProgress?.(ev.progress);
      if (ev.type === 'job:done' && ev.jobId === jobId) {
        settled = true;
        off();
        resolve(ev.result as JobResultMap[K]);
      }
      if (ev.type === 'job:failed' && ev.jobId === jobId) {
        settled = true;
        off();
        reject(ev.error);
      }
    });
  });
  result.catch(() => undefined);
  return {
    jobId,
    result,
    cancel: async () => {
      if (settled) return;
      await invoke('job:cancel', { jobId }).catch(() => undefined);
    }
  };
}
