// 診断ログ。ユーザー名/絶対パスをマスクし、音声・フレームは含めない。本人が S5 で閲覧できる。
import { appendFile, mkdir, readFile, stat, rename } from 'node:fs/promises';
import path from 'node:path';
import { maskPaths } from '@media/process';

let logDir = '';
const MAX_BYTES = 2 * 1024 * 1024;

export function initLog(userDataDir: string): void {
  logDir = path.join(userDataDir, 'logs');
}

export function logPath(): string {
  return path.join(logDir, 'maqiri.log');
}

export async function log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): Promise<void> {
  if (!logDir) return;
  try {
    await mkdir(logDir, { recursive: true });
    const file = logPath();
    try {
      const st = await stat(file);
      if (st.size > MAX_BYTES) await rename(file, `${file}.1`);
    } catch {
      /* no file yet */
    }
    const d = detail === undefined ? '' : ' ' + maskPaths(typeof detail === 'string' ? detail : JSON.stringify(detail));
    await appendFile(file, `${new Date().toISOString()} [${level}] ${maskPaths(message)}${d}\n`, 'utf8');
  } catch {
    /* ログ失敗はアプリを止めない */
  }
}

export async function readLogTail(maxBytes = 64 * 1024): Promise<string> {
  try {
    const text = await readFile(logPath(), 'utf8');
    return text.length > maxBytes ? text.slice(-maxBytes) : text;
  } catch {
    return '';
  }
}
