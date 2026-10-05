// スクリプト用の ffmpeg/ffprobe 解決。Windows は同梱の検証済みバイナリ、他はシステム(開発専用)。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');

export function resolveScriptTools() {
  if (process.platform === 'win32') {
    const dir = path.join(repoRoot, 'resources', 'media-tools', 'win32-x64');
    const ffmpeg = path.join(dir, 'ffmpeg.exe');
    const ffprobe = path.join(dir, 'ffprobe.exe');
    if (!existsSync(ffmpeg) || !existsSync(ffprobe)) {
      throw new Error('resources/media-tools/win32-x64 に ffmpeg.exe/ffprobe.exe がありません。npm run media:prepare を実行してください。');
    }
    return { ffmpeg, ffprobe, kind: 'bundled-win32', videoEncoderArgs: ['-c:v', 'h264_mf', '-hw_encoding', '0', '-rate_control', 'pc_vbr', '-bf', '0'] };
  }
  return {
    ffmpeg: process.env.MAQIRI_FFMPEG || 'ffmpeg',
    ffprobe: process.env.MAQIRI_FFPROBE || 'ffprobe',
    kind: 'system-dev',
    videoEncoderArgs: ['-c:v', 'libx264', '-preset', 'veryfast']
  };
}

export function run(cmd, args, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${path.basename(cmd)} ${args.slice(0, 6).join(' ')}... exited ${code}${quiet ? '' : `\n${err.slice(-4000)}`}`));
    });
  });
}
