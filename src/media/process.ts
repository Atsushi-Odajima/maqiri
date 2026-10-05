// 子プロセス実行ラッパー。shell:false、引数は配列、タイムアウト/停滞検知/ログ上限/キャンセル。
import { spawn, type ChildProcess } from 'node:child_process';
import { AppError } from '@shared/errors';

export interface RunToolOptions {
  args: string[];
  timeoutMs: number;
  /** 一定時間出力が無ければ停滞と見なして停止する(0 で無効) */
  stallTimeoutMs?: number;
  signal?: AbortSignal;
  /** 'q' を stdin に送って 5 秒待つ(ffmpeg)。ffprobe は false。 */
  gracefulQuit?: boolean;
  onStdoutChunk?: (chunk: Buffer) => void;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  /** stderr の保持上限(バイト) */
  stderrLimit?: number;
  stdoutLimit?: number;
  cwd?: string;
}

export interface RunToolResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
  stdoutText: string;
  elapsedMs: number;
  cancelled: boolean;
  timedOut: boolean;
}

const GRACE_MS = 5000;

export function runTool(binary: string, opts: RunToolOptions): Promise<RunToolResult> {
  return new Promise<RunToolResult>((resolve, reject) => {
    const started = Date.now();
    let child: ChildProcess;
    try {
      child = spawn(binary, opts.args, {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(opts.cwd ? { cwd: opts.cwd } : {})
      });
    } catch (e) {
      reject(new AppError('E_TOOLS', '変換ツールを起動できませんでした。', { detail: e instanceof Error ? e.message : String(e) }));
      return;
    }
    const stderrLimit = opts.stderrLimit ?? 64 * 1024;
    const stdoutLimit = opts.stdoutLimit ?? 4 * 1024 * 1024;
    let stderrBuf = '';
    let stdoutBuf = '';
    let stdoutLineRest = '';
    let stderrLineRest = '';
    let cancelled = false;
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;
    let stallTimer: NodeJS.Timeout | null = null;

    const touch = () => {
      if (!opts.stallTimeoutMs) return;
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        timedOut = true;
        hardKill();
      }, opts.stallTimeoutMs);
    };

    const hardKill = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    };

    const requestStop = () => {
      if (opts.gracefulQuit && child.stdin && !child.stdin.destroyed) {
        try {
          child.stdin.write('q\n');
        } catch {
          /* ignore */
        }
        killTimer = setTimeout(hardKill, GRACE_MS);
      } else {
        hardKill();
      }
    };

    const onAbort = () => {
      cancelled = true;
      requestStop();
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      requestStop();
    }, opts.timeoutMs);
    touch();

    child.stdout?.on('data', (chunk: Buffer) => {
      touch();
      if (opts.onStdoutChunk) opts.onStdoutChunk(chunk);
      if (opts.onStdoutLine || !opts.onStdoutChunk) {
        const text = stdoutLineRest + chunk.toString('utf8');
        const lines = text.split(/\r?\n|\r/);
        stdoutLineRest = lines.pop() ?? '';
        for (const line of lines) {
          if (opts.onStdoutLine) opts.onStdoutLine(line);
          if (!opts.onStdoutChunk && stdoutBuf.length < stdoutLimit) stdoutBuf += line + '\n';
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      touch();
      const text = stderrLineRest + chunk.toString('utf8');
      const lines = text.split(/\r?\n|\r/);
      stderrLineRest = lines.pop() ?? '';
      for (const line of lines) {
        opts.onStderrLine?.(line);
        stderrBuf += line + '\n';
        if (stderrBuf.length > stderrLimit) stderrBuf = stderrBuf.slice(stderrBuf.length - stderrLimit);
      }
    });
    child.stdin?.on('error', () => {
      /* EPIPE when the child exits first */
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new AppError('E_TOOLS', '変換ツールの実行に失敗しました。', { detail: e.message }));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (stdoutLineRest && !opts.onStdoutChunk) {
        opts.onStdoutLine?.(stdoutLineRest);
        stdoutBuf += stdoutLineRest;
      }
      if (stderrLineRest) {
        opts.onStderrLine?.(stderrLineRest);
        stderrBuf += stderrLineRest;
      }
      resolve({ code, signal, stderrTail: stderrBuf, stdoutText: stdoutBuf, elapsedMs: Date.now() - started, cancelled, timedOut });
    });

    function cleanup() {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (stallTimer) clearTimeout(stallTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  });
}

/** ログからユーザー名・絶対パスをマスクする。 */
export function maskPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:\\(?:[^\\\s"']+\\)*[^\\\s"']*/g, '<path>')
    .replace(/\\\\[^\s"']+/g, '<unc-path>')
    .replace(/\/(?:home|Users|root)\/[^\s"':]*/g, '<path>')
    .replace(/\/(?:tmp|var|mnt|media)\/[^\s"':]*/g, '<path>');
}
