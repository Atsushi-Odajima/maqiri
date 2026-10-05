// キャッシュ: userData/cache/<projectKey>/<revision>/...。上限 2GiB、LRU、使用中ファイル除外。
// 清掃で素材や購入ファイルを消さない(cache ディレクトリ配下のみ操作)。
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { CACHE_LIMIT_BYTES } from '@shared/constants';

export class CacheManager {
  private readonly inUse = new Set<string>();
  private limitBytes = CACHE_LIMIT_BYTES;
  constructor(private readonly root: string) {}

  get rootDir(): string {
    return this.root;
  }

  setLimit(bytes: number): void {
    this.limitBytes = Math.max(256 * 1024 * 1024, bytes);
  }

  get limit(): number {
    return this.limitBytes;
  }

  async dirFor(projectKey: string, revision: number): Promise<string> {
    const dir = path.join(this.root, sanitize(projectKey), String(revision));
    await mkdir(dir, { recursive: true });
    return dir;
  }

  markInUse(file: string): void {
    this.inUse.add(path.resolve(file));
  }

  releaseAll(): void {
    this.inUse.clear();
  }

  async totalBytes(): Promise<number> {
    let total = 0;
    for (const f of await this.listFiles()) total += f.size;
    return total;
  }

  private async listFiles(): Promise<Array<{ file: string; size: number; atimeMs: number }>> {
    const out: Array<{ file: string; size: number; atimeMs: number }> = [];
    const walk = async (dir: string): Promise<void> => {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      for (const n of names) {
        const p = path.join(dir, n);
        try {
          const st = await stat(p);
          if (st.isDirectory()) await walk(p);
          else out.push({ file: p, size: st.size, atimeMs: Math.max(st.atimeMs, st.mtimeMs) });
        } catch {
          /* ignore */
        }
      }
    };
    await walk(this.root);
    return out;
  }

  /** 上限を超えていれば古いものから削除(使用中は除外)。 */
  async enforceLimit(): Promise<{ removed: number; bytes: number }> {
    const files = await this.listFiles();
    let total = files.reduce((a, f) => a + f.size, 0);
    files.sort((a, b) => a.atimeMs - b.atimeMs);
    let removed = 0;
    let freed = 0;
    for (const f of files) {
      if (total <= this.limitBytes) break;
      if (this.inUse.has(path.resolve(f.file))) continue;
      await rm(f.file, { force: true }).catch(() => undefined);
      total -= f.size;
      freed += f.size;
      removed++;
    }
    await this.pruneEmptyDirs(this.root);
    return { removed, bytes: freed };
  }

  /** 使用中以外をすべて削除(明示操作)。 */
  async clearAll(): Promise<{ removed: number; bytes: number }> {
    const files = await this.listFiles();
    let removed = 0;
    let freed = 0;
    for (const f of files) {
      if (this.inUse.has(path.resolve(f.file))) continue;
      await rm(f.file, { force: true }).catch(() => undefined);
      removed++;
      freed += f.size;
    }
    await this.pruneEmptyDirs(this.root);
    return { removed, bytes: freed };
  }

  private async pruneEmptyDirs(dir: string): Promise<boolean> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return false;
    }
    let empty = true;
    for (const n of names) {
      const p = path.join(dir, n);
      try {
        const st = await stat(p);
        if (st.isDirectory()) {
          const sub = await this.pruneEmptyDirs(p);
          if (sub) await rm(p, { recursive: true, force: true }).catch(() => undefined);
          else empty = false;
        } else empty = false;
      } catch {
        empty = false;
      }
    }
    return empty && dir !== this.root;
  }
}

function sanitize(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'project';
}
