// main 側のセキュリティ/IO ロジックの単体テスト(Electron API はモック)。
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({ protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() }, app: { getPath: () => tmpdir() } }));

import { _parseRangeForTests as parseRange, _resolveFileForTests as resolveFile, registerCacheMedia } from '../../src/main/protocol';
import { registerAsset, getAsset, issueToken, resolveToken } from '../../src/main/assets';
import { loadProjectFile, saveProject, listRecoveryCandidates, resolveRecovery, createProjectStore } from '../../src/main/projects';
import { csvCell, atomicWriteFile, uniqueOutputPath } from '../../src/main/fsutil';
import { JobManager } from '../../src/main/jobs';
import { CacheManager } from '../../src/main/cache';
import { limitFramesFor } from '../../src/main/edition';
import type { ProjectFile } from '../../src/shared/schemas';

const tmp = mkdtempSync(path.join(tmpdir(), 'maqiri-test-'));

describe('media protocol', () => {
  it('range parsing is bounded and validated', () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=0-', 100 * 1024 * 1024)).toEqual({ start: 0, end: 8 * 1024 * 1024 - 1 });
    expect(parseRange('bytes=1000-', 1000)).toBe('invalid');
    expect(parseRange('bytes=5-2', 1000)).toBe('invalid');
    expect(parseRange('items=0-1', 1000)).toBe('invalid');
  });
  it('rejects traversal, unknown ids, drives and UNC', async () => {
    const file = path.join(tmp, 'a.mp4');
    writeFileSync(file, 'x');
    const rec = await registerAsset(file);
    expect(resolveFile(new URL(`maqiri-media://asset/${rec.assetId}`))).toBe(rec.realPath);
    expect(resolveFile(new URL('maqiri-media://asset/0123456789abcdef0123456789abcdef'))).toBeNull();
    expect(resolveFile(new URL('maqiri-media://asset/../../etc/passwd'))).toBeNull();
    expect(resolveFile(new URL('maqiri-media://asset/%2e%2e%2f'))).toBeNull();
    expect(resolveFile(new URL(`maqiri-media://asset/${rec.assetId}?x=1`))).toBeNull();
    expect(resolveFile(new URL('maqiri-media://file/C:/Windows/system32'))).toBeNull();
    expect(resolveFile(new URL('maqiri-media://asset//server/share'))).toBeNull();
    const url = registerCacheMedia('abcdefabcdefabcdefabcdefabcdefab', file);
    expect(resolveFile(new URL(url))).toBe(file);
  });
});

describe('assets & tokens', () => {
  it('unknown assetId and token kinds are rejected', () => {
    expect(() => getAsset('ffffffffffffffffffffffffffffffff')).toThrow(/見つかりません/);
    const tok = issueToken('destination', '/x/y.mp4', { assetId: 'a' });
    expect(resolveToken('destination', tok).value).toBe('/x/y.mp4');
    expect(() => resolveToken('export', tok)).toThrow();
    expect(() => resolveToken('destination', '0'.repeat(32))).toThrow();
  });
});

function sampleProject(): ProjectFile {
  return {
    product: 'Maqiri',
    schemaVersion: 1,
    id: '6f1b6c6e-9a1b-4b2e-8e0f-0b1c2d3e4f50',
    title: '<img src=x onerror=alert(1)> =cmd|evil',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    source: {
      basename: 'a.mp4',
      absolutePath: '/videos/a.mp4',
      sha256: 'a'.repeat(64),
      sizeBytes: 10,
      mtimeMs: 1,
      durationUs: 10_000_000,
      firstVideoPtsUs: 0,
      videoStreamIndex: 0,
      audioStreamIndex: 1,
      displayWidth: 1920,
      displayHeight: 1080,
      rotation: 0,
      frameRateNum: 30,
      frameRateDen: 1,
      sampleRate: 48000,
      channels: 2,
      codec: 'h264',
      colorInfo: { range: null, space: null, transfer: null, primaries: null, pixFmt: 'yuv420p', assumedBt709: true }
    },
    settings: { thresholdDb: -35, minSilenceMs: 800, padBeforeMs: 150, padAfterMs: 150, outputPreset: '1080p30' },
    manualKeepRanges: [{ id: 'k1', reason: 'user-keep', startFrame: 305, endFrame: 355 }],
    manualCutRanges: [],
    cutRanges: [{ id: 'c1', candidateId: 'c305-355', reason: 'auto', startFrame: 305, endFrame: 355 }],
    algorithmVersion: 'rms20-v1',
    revision: 3,
    lastExport: null
  };
}

describe('project files', () => {
  it('round-trips with atomic write and .bak, keeps hostile title as data', async () => {
    const file = path.join(tmp, 'p.maqiri.json');
    const p = sampleProject();
    await saveProject(file, p);
    await saveProject(file, { ...p, revision: 4 });
    expect(existsSync(`${file}.bak`)).toBe(true);
    expect(existsSync(`${file}.tmp`)).toBe(false);
    const loaded = await loadProjectFile(file);
    expect(loaded.revision).toBe(4);
    expect(loaded.title).toBe(p.title);
    expect(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).revision).toBe(3);
  });
  it('rejects unknown schema versions and foreign products without editing', async () => {
    const f1 = path.join(tmp, 'v2.maqiri.json');
    writeFileSync(f1, JSON.stringify({ ...sampleProject(), schemaVersion: 2 }));
    await expect(loadProjectFile(f1)).rejects.toMatchObject({ code: 'E_PROJECT_SCHEMA' });
    const f2 = path.join(tmp, 'other.json');
    writeFileSync(f2, JSON.stringify({ product: 'Other', schemaVersion: 1 }));
    await expect(loadProjectFile(f2)).rejects.toMatchObject({ code: 'E_PROJECT_SCHEMA' });
    const f3 = path.join(tmp, 'bad.json');
    writeFileSync(f3, '{not json');
    await expect(loadProjectFile(f3)).rejects.toMatchObject({ code: 'E_PROJECT_SCHEMA' });
    const f4 = path.join(tmp, 'badframes.maqiri.json');
    const bad = sampleProject();
    bad.cutRanges = [{ id: 'c', candidateId: 'c', reason: 'auto', startFrame: 10.5 as unknown as number, endFrame: 5 }];
    writeFileSync(f4, JSON.stringify(bad));
    await expect(loadProjectFile(f4)).rejects.toMatchObject({ code: 'E_PROJECT_SCHEMA' });
  });
  it('recovery candidates: leftover .tmp is offered, restore moves current to .bak', async () => {
    const dir = mkdtempSync(path.join(tmp, 'ud-'));
    const store = createProjectStore(dir);
    const file = path.join(store.projectsDir, `${sampleProject().id}.maqiri.json`);
    await saveProject(file, sampleProject());
    writeFileSync(`${file}.tmp`, JSON.stringify({ ...sampleProject(), revision: 9 }));
    const cands = await listRecoveryCandidates(store);
    expect(cands).toHaveLength(1);
    expect(cands[0]!.targetPath).toBe(file);
    await resolveRecovery(cands[0]!, 'restore');
    expect((await loadProjectFile(file)).revision).toBe(9);
    expect(existsSync(`${file}.bak`)).toBe(true);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});

describe('fsutil', () => {
  it('csvCell neutralizes spreadsheet formulas and quotes', () => {
    expect(csvCell('=cmd|evil')).toBe("'=cmd|evil");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-x')).toBe("'-x");
    expect(csvCell('@a')).toBe("'@a");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell(12)).toBe('12');
  });
  it('atomicWriteFile without backup and uniqueOutputPath numbering', async () => {
    const f = path.join(tmp, 'x.txt');
    await atomicWriteFile(f, 'a', false);
    await atomicWriteFile(f, 'b', false);
    expect(readFileSync(f, 'utf8')).toBe('b');
    expect(existsSync(`${f}.bak`)).toBe(false);
    writeFileSync(path.join(tmp, 'out_maqiri.mp4'), '');
    writeFileSync(path.join(tmp, 'out_maqiri_2.mp4'), '');
    expect(path.basename(await uniqueOutputPath(tmp, 'out_maqiri.mp4'))).toBe('out_maqiri_3.mp4');
  });
});

describe('job manager', () => {
  let progress: unknown[];
  beforeEach(() => {
    progress = [];
  });
  it('runs one at a time, export preempts analysis, cancel rejects with E_CANCELLED', async () => {
    const jm = new JobManager((p) => progress.push(p));
    const order: string[] = [];
    const a = jm.submit('analysis', async (ctx) => {
      order.push('analysis-start');
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 500);
        ctx.signal.addEventListener('abort', () => {
          clearTimeout(t);
          resolve();
        });
      });
      order.push('analysis-end');
      return 'a';
    });
    const e = jm.submit('export', async () => {
      order.push('export');
      return 'e';
    });
    await expect(a.result).rejects.toMatchObject({ code: 'E_CANCELLED' });
    await expect(e.result).resolves.toBe('e');
    expect(order[0]).toBe('analysis-start');
    expect(order).toContain('export');
    expect(jm.activeKind).toBeNull();
  });
  it('queued jobs can be cancelled by id; replaceKey replaces pending previews', async () => {
    const jm = new JobManager(() => undefined);
    const blocker = jm.submit('export', () => new Promise<string>((r) => setTimeout(() => r('x'), 100)));
    const p1 = jm.submit('preview', async () => 'p1', { replaceKey: 'junction' });
    const p2 = jm.submit('preview', async () => 'p2', { replaceKey: 'junction' });
    await expect(p1.result).rejects.toMatchObject({ code: 'E_CANCELLED' });
    const q = jm.submit('hash', async () => 'h');
    expect(jm.cancel(q.jobId)).toBe(true);
    await expect(q.result).rejects.toMatchObject({ code: 'E_CANCELLED' });
    await expect(blocker.result).resolves.toBe('x');
    await expect(p2.result).resolves.toBe('p2');
  });
});

describe('cache LRU', () => {
  it('enforces the limit by oldest first and skips in-use files', async () => {
    const root = mkdtempSync(path.join(tmp, 'cache-'));
    const cm = new CacheManager(root);
    cm.setLimit(256 * 1024 * 1024);
    const dir = await cm.dirFor('proj', 1);
    const big = Buffer.alloc(100 * 1024 * 1024);
    for (const n of ['a', 'b', 'c']) writeFileSync(path.join(dir, `${n}.mp4`), big);
    const now = Date.now() / 1000;
    const { utimesSync } = await import('node:fs');
    utimesSync(path.join(dir, 'a.mp4'), now - 300, now - 300);
    utimesSync(path.join(dir, 'b.mp4'), now - 200, now - 200);
    utimesSync(path.join(dir, 'c.mp4'), now - 100, now - 100);
    cm.markInUse(path.join(dir, 'a.mp4'));
    const r = await cm.enforceLimit();
    expect(r.removed).toBe(1);
    expect(existsSync(path.join(dir, 'a.mp4'))).toBe(true); // in use
    expect(existsSync(path.join(dir, 'b.mp4'))).toBe(false); // oldest removable
    expect(existsSync(path.join(dir, 'c.mp4'))).toBe(true);
  });
});

describe('edition gate', () => {
  it('demo clips to 2700 frames, full does not', () => {
    expect(limitFramesFor('demo', 54000)).toBe(2700);
    expect(limitFramesFor('demo', 1000)).toBe(1000);
    expect(limitFramesFor('full', 54000)).toBe(54000);
  });
});
