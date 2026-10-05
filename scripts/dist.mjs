#!/usr/bin/env node
// 配布ビルド: node scripts/dist.mjs demo|full
// 1) 同梱ツールのハッシュ検証 2) APP_EDITION を埋め込んでビルド 3) electron-builder(NSIS x64, per-user) 4) SHA256SUMS.txt
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edition = (process.argv[2] ?? '').toLowerCase();
if (edition !== 'demo' && edition !== 'full') {
  console.error('usage: node scripts/dist.mjs demo|full');
  process.exit(2);
}
const label = edition === 'demo' ? 'Demo' : 'Full';

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', cwd: root, env: { ...process.env, ...env } });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

async function sha256(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function main() {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // 1) 同梱ツール検証(未検証バイナリでの配布を防ぐ)
  await run('node', ['scripts/prepare-media-tools.mjs', '--verify-only']);
  if (!existsSync(path.join(root, 'resources', 'media-tools', 'win32-x64', 'ffmpeg.exe'))) {
    throw new Error('resources/media-tools/win32-x64/ffmpeg.exe がありません。npm run media:prepare を実行してください。');
  }
  // 2) 配布用ドキュメントを docs/dist へ集約
  const distDocs = path.join(root, 'docs', 'dist');
  mkdirSync(distDocs, { recursive: true });
  for (const f of ['START_HERE_JA.txt', 'FORMAT_LIMITS.txt', 'EULA_DRAFT.txt', 'THIRD_PARTY_NOTICES.txt', 'CHANGELOG.txt']) {
    const src = path.join(root, 'docs', f);
    if (existsSync(src)) cpSync(src, path.join(distDocs, f));
  }
  cpSync(path.join(root, 'resources', 'media-tools', 'win32-x64', 'LICENSE.txt'), path.join(distDocs, 'FFMPEG_LICENSE_LGPLv3.txt'));
  // 3) ビルド(edition を define で埋め込む)
  await run('node', ['scripts/generate-sample.mjs']);
  await run(npx, ['electron-vite', 'build'], { APP_EDITION: edition });
  // 4) electron-builder
  const productName = edition === 'demo' ? 'Maqiri Demo' : 'Maqiri';
  const appId = edition === 'demo' ? 'jp.maqiri.app.demo' : 'jp.maqiri.app';
  await run(npx, ['electron-builder', '--win', '--x64', '--config', 'electron-builder.yml', '-c.productName=' + productName, '-c.appId=' + appId, `-c.extraMetadata.name=maqiri-${edition}`], {
    APP_EDITION: edition,
    APP_EDITION_LABEL: label,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false'
  });
  // 5) SHA256SUMS.txt
  const outDir = path.join(root, 'release', edition);
  const files = readdirSync(outDir).filter((f) => f.endsWith('.exe') || f.endsWith('.zip'));
  const lines = [];
  for (const f of files) lines.push(`${await sha256(path.join(outDir, f))}  ${f}`);
  writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  console.log(`[dist] ${edition}: ${files.join(', ')} (SHA256SUMS.txt written)`);
  console.log('[dist] 注意: 署名証明書が設定されていない場合、この実行ファイルは未署名です。SmartScreen 警告が出ることを購入者へ正直に案内してください。');
}

main().catch((e) => {
  console.error(`[dist] ERROR ${e.message}`);
  process.exit(1);
});
