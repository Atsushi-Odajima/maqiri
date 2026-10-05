#!/usr/bin/env node
// 同梱サンプル(10 秒、720p、3 か所の無音)を lavfi で生成する。権利問題のない人工素材。
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveScriptTools, run, repoRoot } from './lib/tools.mjs';

const outDir = path.join(repoRoot, 'resources', 'sample');
const out = path.join(outDir, 'sample_10s.mp4');
const tools = resolveScriptTools();

async function main() {
  await mkdir(outDir, { recursive: true });
  if (existsSync(out) && !process.argv.includes('--force')) {
    process.stdout.write('[sample] exists\n');
    return;
  }
  const amp = (Math.pow(10, -20 / 20) * Math.sqrt(3)).toFixed(6);
  // 発話 [0.3,2.8) [4.2,6.0) [7.6,9.7)、無音 [2.8,4.2) 1.4s, [6.0,7.6) 1.6s
  const speech = ['between(t,0.3,2.8)', 'between(t,4.2,6.0)', 'between(t,7.6,9.7)'].join('+');
  const expr = `${amp}*(2*random(0)-1)*(${speech})+0.002*(2*random(1)-1)`;
  const font = path.join(repoRoot, 'assets', 'fonts', 'NotoSansJP.ttf').replace(/\\/g, '/').replace(/:/g, '\\:');
  const texts = [
    [0.3, 2.8, 'サンプル動画です'],
    [4.2, 6.0, '間を詰める練習'],
    [7.6, 9.7, '書き出しを試す']
  ];
  const draw = texts
    .map(([s, e, t]) => `drawtext=fontfile='${font}':text='${t}':x=(w-text_w)/2:y=(h-text_h)/2:fontsize=64:fontcolor=0xEFE6D8:enable='between(t,${s},${e})'`)
    .join(',');
  const video = `color=c=0x27221E:s=1280x720:r=30:d=10,${draw}`;
  const audio = `aevalsrc=exprs='${expr}|${expr}':s=48000:c=stereo:d=10`;
  const enc = tools.kind === 'system-dev' ? ['-c:v', 'libx264', '-preset', 'veryfast'] : ['-c:v', 'h264_mf', '-hw_encoding', '0'];
  await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-nostdin', '-f', 'lavfi', '-i', video, '-f', 'lavfi', '-i', audio, '-map', '0:v', '-map', '1:a', ...enc, '-pix_fmt', 'yuv420p', '-b:v', '2500k', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', '10', out]);
  process.stdout.write(`[sample] generated ${path.relative(repoRoot, out)}\n`);
}

main().catch((e) => {
  process.stderr.write(`[sample] ERROR ${e.message}\n`);
  process.exit(1);
});
