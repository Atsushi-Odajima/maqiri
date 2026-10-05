// ffmpeg / ffprobe の解決とハッシュ検証。
// Windows(配布版): resources/media-tools/win32-x64 の検証済みバイナリのみ。
// 開発ホスト(Linux/macOS): テスト用にシステム ffmpeg を使う(dev-only、配布しない)。
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { AppError } from '@shared/errors';

export type ToolsKind = 'bundled-win32' | 'system-dev';

export interface MediaTools {
  kind: ToolsKind;
  ffmpeg: string;
  ffprobe: string;
  /** 配布版の manifest(ハッシュ)。dev では null */
  manifest: ToolsManifest | null;
}

export interface ToolsManifest {
  target: string;
  ffmpegVersionString: string;
  files: Record<string, { sha256: string; sizeBytes: number }>;
}

export function resolveTools(mediaToolsDir: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): MediaTools {
  if (platform === 'win32') {
    const dir = path.join(mediaToolsDir, 'win32-x64');
    const ffmpeg = path.join(dir, 'ffmpeg.exe');
    const ffprobe = path.join(dir, 'ffprobe.exe');
    const manifestPath = path.join(dir, 'manifest.json');
    if (!existsSync(ffmpeg) || !existsSync(ffprobe) || !existsSync(manifestPath)) {
      throw new AppError('E_TOOLS', '同梱の変換ツールが見つかりません。', {
        nextAction: 'アプリを再インストールしてください。開発時は npm run media:prepare を実行してください。'
      });
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ToolsManifest;
    return { kind: 'bundled-win32', ffmpeg, ffprobe, manifest };
  }
  // dev host
  const ffmpeg = env['MAQIRI_FFMPEG'] ?? 'ffmpeg';
  const ffprobe = env['MAQIRI_FFPROBE'] ?? 'ffprobe';
  return { kind: 'system-dev', ffmpeg, ffprobe, manifest: null };
}

export async function sha256File(file: string, onProgress?: (bytes: number) => void): Promise<string> {
  const hash = createHash('sha256');
  let done = 0;
  const src = createReadStream(file, { highWaterMark: 4 * 1024 * 1024 });
  src.on('data', (chunk) => {
    done += chunk.length;
    onProgress?.(done);
  });
  await pipeline(src, hash);
  return hash.digest('hex');
}

/** 配布版バイナリのハッシュを manifest と照合する。不一致なら E_TOOLS。 */
export async function verifyBundledTools(tools: MediaTools): Promise<void> {
  if (tools.kind !== 'bundled-win32' || !tools.manifest) return;
  const dir = path.dirname(tools.ffmpeg);
  for (const [name, expected] of Object.entries(tools.manifest.files)) {
    const file = path.join(dir, name);
    if (!existsSync(file)) throw new AppError('E_TOOLS', `同梱ツール ${name} が見つかりません。`, { nextAction: 'アプリを再インストールしてください。' });
    const digest = await sha256File(file);
    if (digest !== expected.sha256) {
      throw new AppError('E_TOOLS', `同梱ツール ${name} の内容が配布時と異なります。`, {
        nextAction: 'アプリを再インストールしてください。改変されたバイナリは実行しません。',
        detail: `expected ${expected.sha256} got ${digest}`
      });
    }
  }
}
