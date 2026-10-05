#!/usr/bin/env node
// Maqiri: 同梱メディアツール(FFmpeg/ffprobe)の取得と検証。
// - media-tools.lock.json に固定した URL / SHA256 のみを使う(latest リンクは引かない)。
// - zip の SHA256、展開した各ファイルの SHA256 を検証し、manifest.json を書き出す。
// - 対応ソース(FFmpeg のコミット、BtbN ビルドスクリプト)を git archive で生成する。
// 使い方: node scripts/prepare-media-tools.mjs [--verify-only] [--skip-source] [--skip-download]
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const lockPath = path.join(root, 'media-tools.lock.json');
const toolsDir = path.join(root, 'resources', 'media-tools');
const downloadsDir = path.join(toolsDir, 'downloads');
const sourceDir = path.join(toolsDir, 'source');

const args = new Set(process.argv.slice(2));
const verifyOnly = args.has('--verify-only');
const skipSource = args.has('--skip-source');
const skipDownload = args.has('--skip-download');

function log(msg) {
  process.stdout.write(`[media:prepare] ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`[media:prepare] ERROR: ${msg}\n`);
  process.exit(1);
}

async function sha256File(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function fileMatches(file, expected) {
  if (!existsSync(file)) return { ok: false, reason: 'missing' };
  const st = await stat(file);
  if (expected.sizeBytes !== undefined && st.size !== expected.sizeBytes) {
    return { ok: false, reason: `size ${st.size} != ${expected.sizeBytes}` };
  }
  const digest = await sha256File(file);
  if (digest !== expected.sha256) return { ok: false, reason: `sha256 ${digest} != ${expected.sha256}` };
  return { ok: true };
}

async function download(url, dest) {
  log(`download ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) fail(`download failed: HTTP ${res.status} ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(res.body, createWriteStream(tmp));
  await rename(tmp, dest);
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, ...opts });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err}`))));
  });
}

// zip から特定エントリを取り出す。外部依存を避けるため最小限の ZIP(ZIP64 含む)リーダーを実装。
async function extractZipEntries(zipPath, wanted /* Map archivePath -> destPath */) {
  const buf = await readFile(zipPath);
  // End of central directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let cdCount = buf.readUInt16LE(eocd + 10);
  // ZIP64?
  if (cdOffset === 0xffffffff || cdCount === 0xffff) {
    const loc = eocd - 20;
    if (buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('ZIP64 locator not found');
    const z64Off = Number(buf.readBigUInt64LE(loc + 8));
    if (buf.readUInt32LE(z64Off) !== 0x06064b50) throw new Error('ZIP64 EOCD not found');
    cdCount = Number(buf.readBigUInt64LE(z64Off + 32));
    cdOffset = Number(buf.readBigUInt64LE(z64Off + 48));
  }
  const { inflateRawSync } = await import('node:zlib');
  let p = cdOffset;
  const found = new Set();
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    let uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // ZIP64 extra
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOff === 0xffffffff) {
      let ep = p + 46 + nameLen;
      const end = ep + extraLen;
      while (ep + 4 <= end) {
        const id = buf.readUInt16LE(ep);
        const sz = buf.readUInt16LE(ep + 2);
        if (id === 0x0001) {
          let q = ep + 4;
          if (uncompSize === 0xffffffff) {
            uncompSize = Number(buf.readBigUInt64LE(q));
            q += 8;
          }
          if (compSize === 0xffffffff) {
            compSize = Number(buf.readBigUInt64LE(q));
            q += 8;
          }
          if (localOff === 0xffffffff) {
            localOff = Number(buf.readBigUInt64LE(q));
            q += 8;
          }
        }
        ep += 4 + sz;
      }
    }
    const dest = wanted.get(name);
    if (dest) {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('bad local header');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      let out;
      if (method === 0) out = data;
      else if (method === 8) out = inflateRawSync(data);
      else throw new Error(`unsupported compression method ${method} for ${name}`);
      if (out.length !== uncompSize) throw new Error(`size mismatch for ${name}`);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, out);
      found.add(name);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  for (const name of wanted.keys()) {
    if (!found.has(name)) throw new Error(`entry not found in zip: ${name}`);
  }
}

async function prepareTarget(targetName, target) {
  const outDir = path.join(toolsDir, targetName);
  await mkdir(outDir, { recursive: true });
  const fileNames = Object.keys(target.files);

  // 1) 既存ファイルの検証
  let allOk = true;
  for (const fileName of fileNames) {
    const r = await fileMatches(path.join(outDir, fileName), target.files[fileName]);
    if (!r.ok) {
      allOk = false;
      log(`${targetName}/${fileName}: ${r.reason}`);
    } else {
      log(`${targetName}/${fileName}: OK (sha256 verified)`);
    }
  }
  if (allOk) {
    await writeManifest(targetName, target, outDir);
    return true;
  }
  if (verifyOnly) return false;
  if (skipDownload) {
    log(`${targetName}: files missing/mismatched and --skip-download given`);
    return false;
  }

  // 2) zip 取得(固定 URL)と検証
  await mkdir(downloadsDir, { recursive: true });
  const zipPath = path.join(downloadsDir, target.archive.fileName);
  let zipOk = (await fileMatches(zipPath, target.archive)).ok;
  if (!zipOk) {
    await download(target.archive.url, zipPath);
    const r = await fileMatches(zipPath, target.archive);
    if (!r.ok) {
      await rm(zipPath, { force: true });
      fail(`downloaded archive does not match lock: ${r.reason}. ロックファイルの URL/SHA256 を確認し、未検証のバイナリを使わないこと。`);
    }
    zipOk = true;
  }
  log(`archive OK: ${target.archive.fileName}`);

  // 3) 展開と各ファイル検証
  const wanted = new Map();
  for (const fileName of fileNames) wanted.set(target.files[fileName].archivePath, path.join(outDir, fileName));
  await extractZipEntries(zipPath, wanted);
  for (const fileName of fileNames) {
    const r = await fileMatches(path.join(outDir, fileName), target.files[fileName]);
    if (!r.ok) fail(`extracted ${fileName} mismatch: ${r.reason}`);
    log(`${targetName}/${fileName}: extracted and verified`);
  }
  await writeManifest(targetName, target, outDir);
  return true;
}

async function writeManifest(targetName, target, outDir) {
  const manifest = {
    target: targetName,
    ffmpegVersionString: target.ffmpegVersionString,
    ffmpegCommit: target.ffmpegCommit,
    releaseTag: target.releaseTag,
    license: target.license.spdx,
    files: Object.fromEntries(Object.entries(target.files).map(([k, v]) => [k, { sha256: v.sha256, sizeBytes: v.sizeBytes }])),
    windowsRuntimeVerification: target.windowsRuntimeVerification.status
  };
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

async function archiveGit(repoUrl, commit, expectedTree, prefix, outFile, fetchRef) {
  if (existsSync(outFile)) {
    log(`source archive exists: ${path.relative(root, outFile)}`);
    return;
  }
  const work = path.join(tmpdir(), `maqiri-src-${Date.now()}`);
  await mkdir(work, { recursive: true });
  try {
    await run('git', ['init', '-q', work]);
    await run('git', ['-C', work, 'remote', 'add', 'origin', repoUrl]);
    log(`git fetch ${repoUrl} ${fetchRef}`);
    try {
      await run('git', ['-C', work, 'fetch', '--depth', '1', 'origin', commit]);
    } catch {
      await run('git', ['-C', work, 'fetch', '--depth', '60', 'origin', fetchRef]);
    }
    const tree = (await run('git', ['-C', work, 'rev-parse', `${commit}^{tree}`])).trim();
    if (expectedTree && tree !== expectedTree) fail(`tree hash mismatch for ${commit}: ${tree} != ${expectedTree}`);
    await mkdir(path.dirname(outFile), { recursive: true });
    await run('git', ['-C', work, 'archive', '--format=tar.gz', `--prefix=${prefix}/`, '-o', outFile, commit]);
    log(`source archive written: ${path.relative(root, outFile)} (tree ${tree})`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  let ok = true;
  for (const [targetName, target] of Object.entries(lock.tools)) {
    const r = await prepareTarget(targetName, target);
    ok = ok && r;
    if (!skipSource && !verifyOnly) {
      const cs = target.correspondingSource;
      try {
        await archiveGit(
          'https://github.com/FFmpeg/FFmpeg',
          cs.ffmpeg.commit,
          cs.ffmpeg.tree,
          `ffmpeg-${cs.ffmpeg.commit.slice(0, 10)}`,
          path.join(root, cs.ffmpeg.archiveOutput),
          target.ffmpegReleaseBranch
        );
        await archiveGit(
          cs.buildScripts.repository,
          cs.buildScripts.observedCommit,
          null,
          `ffmpeg-builds-${cs.buildScripts.observedCommit.slice(0, 8)}`,
          path.join(root, cs.buildScripts.archiveOutput),
          'master'
        );
      } catch (e) {
        log(`source archive step failed (配布前に再実行が必要): ${e.message}`);
        ok = false;
      }
    }
    log(`Windows runtime verification status: ${target.windowsRuntimeVerification.status}`);
  }
  if (!ok) fail('one or more steps failed');
  log('done');
}

main().catch((e) => fail(e.stack || String(e)));
