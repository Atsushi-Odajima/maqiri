// ジョブ管理: process 同時数 1。優先順位 export > preview > analysis > probe/hash。
// 実行中の低優先ジョブは、より高い優先度のジョブが来たらキャンセルして切り替える。
import { randomBytes } from 'node:crypto';
import { AppError, toAppError } from '@shared/errors';
import type { JobKind, JobProgress } from '@shared/types';

const PRIORITY: Record<JobKind, number> = { export: 50, preview: 40, analysis: 30, probe: 20, hash: 20, selftest: 10 };

export interface JobContext {
  jobId: string;
  signal: AbortSignal;
  progress: (stage: string, ratio: number | null, detail?: string) => void;
}

interface Job<T> {
  jobId: string;
  kind: JobKind;
  run: (ctx: JobContext) => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  controller: AbortController;
  /** 同じキーの既存ジョブは置き換える(例: junction preview) */
  replaceKey?: string;
}

export class JobManager {
  private queue: Job<unknown>[] = [];
  private active: Job<unknown> | null = null;
  constructor(private readonly emitProgress: (p: JobProgress) => void) {}

  /** ジョブを登録して実行結果を待つ。戻り値の jobId はキャンセル用。 */
  submit<T>(kind: JobKind, run: (ctx: JobContext) => Promise<T>, options: { replaceKey?: string } = {}): { jobId: string; result: Promise<T> } {
    const jobId = randomBytes(16).toString('hex');
    const controller = new AbortController();
    const result = new Promise<T>((resolve, reject) => {
      const job: Job<T> = { jobId, kind, run, resolve, reject, controller, ...(options.replaceKey ? { replaceKey: options.replaceKey } : {}) };
      if (job.replaceKey) {
        for (const q of this.queue.filter((j) => j.replaceKey === job.replaceKey)) this.cancel(q.jobId);
        if (this.active?.replaceKey === job.replaceKey) this.cancel(this.active.jobId);
      }
      this.queue.push(job as Job<unknown>);
      this.queue.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind]);
      // 実行中ジョブより高優先なら、実行中を取り消して切り替える。
      // 取り消して良いのは再開が安い analysis / preview だけ(export は完走、probe/hash/selftest は短いので待つ)。
      if (this.active && PRIORITY[kind] > PRIORITY[this.active.kind] && (this.active.kind === 'analysis' || this.active.kind === 'preview')) {
        this.cancel(this.active.jobId);
      }
      this.pump();
    });
    // 未処理の reject で警告を出さないように
    result.catch(() => undefined);
    return { jobId, result };
  }

  cancel(jobId: string): boolean {
    const qi = this.queue.findIndex((j) => j.jobId === jobId);
    if (qi >= 0) {
      const [job] = this.queue.splice(qi, 1);
      job?.reject(new AppError('E_CANCELLED', 'キャンセルしました。'));
      return true;
    }
    if (this.active?.jobId === jobId) {
      this.active.controller.abort();
      return true;
    }
    return false;
  }

  cancelKind(kind: JobKind): void {
    for (const j of [...this.queue]) if (j.kind === kind) this.cancel(j.jobId);
    if (this.active?.kind === kind) this.cancel(this.active.jobId);
  }

  cancelAll(): void {
    for (const j of [...this.queue]) this.cancel(j.jobId);
    if (this.active) this.cancel(this.active.jobId);
  }

  get activeKind(): JobKind | null {
    return this.active?.kind ?? null;
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    const job = this.queue.shift() as Job<unknown>;
    this.active = job;
    const ctx: JobContext = {
      jobId: job.jobId,
      signal: job.controller.signal,
      progress: (stage, ratio, detail) => {
        const p: JobProgress = { jobId: job.jobId, kind: job.kind, stage, ratio };
        if (detail !== undefined) p.detail = detail;
        this.emitProgress(p);
      }
    };
    job
      .run(ctx)
      .then((v) => {
        if (job.controller.signal.aborted) job.reject(new AppError('E_CANCELLED', 'キャンセルしました。'));
        else job.resolve(v);
      })
      .catch((e) => {
        job.reject(job.controller.signal.aborted ? new AppError('E_CANCELLED', 'キャンセルしました。') : toAppError(e));
      })
      .finally(() => {
        this.active = null;
        this.pump();
      });
  }
}
