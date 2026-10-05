// ファイル IO の補助: atomic 書き込み、空き容量、同一実体判定、ネットワークドライブ判定(Windows)。
import { open, rename, stat, statfs, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AppError } from '@shared/errors';

/** tmp → fsync → rename。前版は .bak として一世代残す。 */
export async function atomicWriteFile(target: string, data: string | Buffer, keepBackup = true): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  if (keepBackup) {
    try {
      await stat(target);
      await rename(target, `${target}.bak`);
    } catch {
      /* 初回保存 */
    }
  }
  await rename(tmp, target);
}

export async function freeBytesAt(dir: string): Promise<number> {
  const s = await statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}

export async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([stat(a), stat(b)]);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  }
}

export async function safeUnlink(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch {
    /* ignore */
  }
}

/** Windows: UNC またはネットワークドライブなら true。他 OS は false(初回は Windows のみ対象)。 */
export async function isNetworkPath(dir: string): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  if (dir.startsWith('\\\\')) return true;
  const m = /^([A-Za-z]):/.exec(path.resolve(dir));
  if (!m) return false;
  const drive = `${m[1]}:`;
  return new Promise<boolean>((resolve) => {
    const child = spawn('fsutil', ['fsinfo', 'drivetype', drive], { shell: false, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(/remote|network/i.test(out)));
  });
}

/** 衝突時は連番(_2, _3, ...)。 */
export async function uniqueOutputPath(dir: string, basename: string): Promise<string> {
  const ext = path.extname(basename);
  const stem = basename.slice(0, basename.length - ext.length);
  let candidate = path.join(dir, basename);
  for (let i = 2; i < 1000; i++) {
    try {
      await stat(candidate);
      candidate = path.join(dir, `${stem}_${i}${ext}`);
    } catch {
      return candidate;
    }
  }
  throw new AppError('E_WRITE', '保存先に同名のファイルが多すぎます。', { nextAction: '別のフォルダーを選んでください。' });
}

/** CSV セル: 先頭 = + - @ は表計算の数式と解釈されないよう ' を前置、" を二重化。 */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
