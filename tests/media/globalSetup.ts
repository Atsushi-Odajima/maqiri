// media テスト前に worker を esbuild でバンドルし、fixture の存在を確認する。
import { build } from 'esbuild';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');

export default async function setup(): Promise<void> {
  const outDir = path.join(root, 'tests', '.build');
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [path.join(root, 'src', 'media', 'analysisWorker.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(outDir, 'analysis-worker.cjs'),
    alias: {
      '@shared': path.join(root, 'src', 'shared'),
      '@domain': path.join(root, 'src', 'domain'),
      '@media': path.join(root, 'src', 'media')
    },
    logLevel: 'silent'
  });
  const manifest = path.join(root, 'tests', 'fixtures', 'generated', 'manifest.json');
  if (!existsSync(manifest)) {
    throw new Error('fixtures missing: run `node scripts/generate-fixtures.mjs` first (npm run test:media does this)');
  }
}
