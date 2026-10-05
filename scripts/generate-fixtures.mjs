#!/usr/bin/env node
// 人工 fixture 生成(FFmpeg lavfi: 色面 + 白フレームマーカー / ノイズ発話 + ビープ + 既知無音)。
// フォント・素材の権利問題なし。出力: tests/fixtures/generated/*.mp4 と manifest.json(期待値)。
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveScriptTools, run, repoRoot } from './lib/tools.mjs';

const outDir = path.join(repoRoot, 'tests', 'fixtures', 'generated');
const tools = resolveScriptTools();
const force = process.argv.includes('--force');
const SR = 48000;
const FONT = path.join(repoRoot, 'assets', 'fonts', 'DMMono-Regular.ttf');

// 発話(ホワイトノイズ)の振幅: RMS = A/sqrt(3)。-20 dBFS → RMS 0.1 → A 0.1732
function ampForDb(db) {
  return Math.pow(10, db / 20) * Math.sqrt(3);
}

/**
 * fixture 定義
 * speech: [[start,end,dbfs]] 秒。quiet はそれ以外(quietDb のノイズ、null なら完全無音)。
 * markers: 秒。白フレーム 1 枚 + 1kHz ビープ 0.2 秒(発話区間内に置く)。
 */
const fixtures = [
  {
    name: 'landscape_1080p30_stereo',
    w: 1920, h: 1080, fps: '30', dur: 40, channels: 2,
    // quiet runs: [0,1.5) head, [10,12) 2.0s, [20,20.78) 780ms, [25,25.8) 800ms exactly, [37,40) tail
    speech: [[1.5, 10, -20], [12, 20, -20], [20.78, 25, -20], [25.8, 37, -20]],
    quietDb: null,
    markers: [5, 15, 30],
    encoder: 'h264'
  },
  {
    name: 'portrait_rotate90',
    w: 1920, h: 1080, fps: '30', dur: 12, channels: 2,
    speech: [[0.5, 4, -20], [6, 12, -20]],
    quietDb: -55, markers: [2, 8], encoder: 'h264', displayRotation: 90
  },
  { name: 'p720_25fps_mono', w: 1280, h: 720, fps: '25', dur: 20, channels: 1, speech: [[0, 6, -20], [8, 20, -20]], quietDb: -55, markers: [3, 12], encoder: 'h264' },
  { name: 'fps2997', w: 640, h: 360, fps: '30000/1001', dur: 20, channels: 2, speech: [[0, 6, -20], [8, 20, -20]], quietDb: -55, markers: [3, 12], encoder: 'h264' },
  { name: 'fps60', w: 640, h: 360, fps: '60', dur: 15, channels: 2, speech: [[0, 5, -20], [7, 15, -20]], quietDb: -55, markers: [2, 10], encoder: 'h264' },
  { name: 'fps50', w: 640, h: 360, fps: '50', dur: 12, channels: 2, speech: [[0, 4, -20], [6, 12, -20]], quietDb: -55, markers: [2, 8], encoder: 'h264' },
  { name: 'fps5994', w: 640, h: 360, fps: '60000/1001', dur: 12, channels: 2, speech: [[0, 4, -20], [6, 12, -20]], quietDb: -55, markers: [2, 8], encoder: 'h264' },
  { name: 'vfr', w: 640, h: 360, fps: '30', dur: 20, channels: 2, speech: [[0, 6, -20], [8, 20, -20]], quietDb: -55, markers: [3, 12], encoder: 'h264', vfr: true },
  { name: 'audio_delay_200ms', w: 640, h: 360, fps: '30', dur: 20, channels: 2, speech: [[0, 6, -20], [8, 20, -20]], quietDb: -55, markers: [3, 12], encoder: 'h264', audioOffset: 0.2 },
  { name: 'audio_lead_150ms', w: 640, h: 360, fps: '30', dur: 20, channels: 2, speech: [[0, 6, -20], [8, 20, -20]], quietDb: -55, markers: [3, 12], encoder: 'h264', videoOffset: 0.15 },
  { name: 'short_audio', w: 640, h: 360, fps: '30', dur: 20, channels: 2, speech: [[0, 6, -20], [8, 17, -20]], quietDb: -55, markers: [3, 12], encoder: 'h264', audioDur: 18 },
  { name: 'negative_pts', w: 640, h: 360, fps: '30', dur: 12, channels: 2, speech: [[0, 4, -20], [6, 12, -20]], quietDb: -55, markers: [2, 8], encoder: 'h264', negativeTs: 0.5 },
  { name: 'left_only', w: 640, h: 360, fps: '30', dur: 12, channels: 2, speech: [[0, 4, -20], [6, 12, -20]], quietDb: null, markers: [2, 8], encoder: 'h264', channelMode: 'left-only' },
  { name: 'inverted_phase', w: 640, h: 360, fps: '30', dur: 12, channels: 2, speech: [[0, 4, -20], [6, 12, -20]], quietDb: null, markers: [2, 8], encoder: 'h264', channelMode: 'inverted' },
  { name: 'faint_voice', w: 640, h: 360, fps: '30', dur: 12, channels: 2, speech: [[0, 4, -42], [6, 12, -42]], quietDb: null, markers: [], encoder: 'h264' },
  { name: 'constant_bgm', w: 640, h: 360, fps: '30', dur: 12, channels: 2, speech: [[0, 4, -20], [6, 12, -20]], quietDb: -30, markers: [2, 8], encoder: 'h264' },
  { name: 'cough_in_gap', w: 640, h: 360, fps: '30', dur: 12, channels: 2, speech: [[0, 4, -20], [5.0, 5.1, -15], [7, 12, -20]], quietDb: -55, markers: [2, 9], encoder: 'h264' },
  { name: 'all_quiet', w: 640, h: 360, fps: '30', dur: 10, channels: 2, speech: [], quietDb: -60, markers: [], encoder: 'h264' },
  { name: 'all_voice', w: 640, h: 360, fps: '30', dur: 10, channels: 2, speech: [[0, 10, -20]], quietDb: null, markers: [], encoder: 'h264' },
  { name: 'two_audio_tracks', w: 640, h: 360, fps: '30', dur: 12, channels: 2, speech: [[0, 4, -20], [6, 12, -20]], quietDb: -55, markers: [2, 8], encoder: 'h264', extraSilentTrackFirst: true },
  { name: 'hevc_8bit', w: 640, h: 360, fps: '30', dur: 12, channels: 2, speech: [[0, 4, -20], [6, 12, -20]], quietDb: -55, markers: [2, 8], encoder: 'hevc' },
  { name: 'no_audio', w: 640, h: 360, fps: '30', dur: 5, channels: 0, speech: [], quietDb: null, markers: [], encoder: 'h264' },
  { name: 'reject_hdr_pq_tags', w: 640, h: 360, fps: '30', dur: 3, channels: 2, speech: [[0, 3, -20]], quietDb: null, markers: [], encoder: 'h264', colorTags: 'pq' },
  { name: 'reject_10bit', w: 640, h: 360, fps: '30', dur: 3, channels: 2, speech: [[0, 3, -20]], quietDb: null, markers: [], encoder: 'h264-10bit' },
  { name: 'reject_interlaced', w: 640, h: 360, fps: '30', dur: 3, channels: 2, speech: [[0, 3, -20]], quietDb: null, markers: [], encoder: 'h264-interlaced' },
  { name: 'reject_4k', w: 3840, h: 2160, fps: '30', dur: 1, channels: 2, speech: [[0, 1, -20]], quietDb: null, markers: [], encoder: 'h264' },
  { name: 'reject_mkv', w: 640, h: 360, fps: '30', dur: 3, channels: 2, speech: [[0, 3, -20]], quietDb: null, markers: [], encoder: 'h264', container: 'mkv' },
  { name: 'reject_vp9', w: 640, h: 360, fps: '30', dur: 3, channels: 2, speech: [[0, 3, -20]], quietDb: null, markers: [], encoder: 'vp9' },
  { name: 'reject_6ch', w: 640, h: 360, fps: '30', dur: 3, channels: 6, speech: [[0, 3, -20]], quietDb: null, markers: [], encoder: 'h264' }
];

function audioExpr(f, channelIndex) {
  const parts = [];
  for (const [s, e, db] of f.speech) {
    const a = ampForDb(db);
    // 各チャンネルで独立したノイズ列(random(k) は k 番目の乱数生成器)
    parts.push(`${a.toFixed(6)}*(2*random(${channelIndex})-1)*between(t,${s},${e})`);
  }
  for (const m of f.markers) parts.push(`0.5*sin(2*PI*1000*t)*between(t,${m},${m + 0.2})`);
  let expr = parts.length ? parts.join('+') : '0';
  if (f.quietDb !== null) {
    // quiet 区間のみ低レベルノイズ(発話区間と重ならないよう not(sum(between)))
    const speechMask = f.speech.length ? f.speech.map(([s, e]) => `between(t,${s},${e})`).join('+') : '0';
    expr += `+${ampForDb(f.quietDb).toFixed(6)}*(2*random(${channelIndex + 4})-1)*not(${speechMask})`;
  }
  return expr;
}

function buildAudioSource(f) {
  if (f.channels === 0) return null;
  let exprs;
  if (f.channelMode === 'left-only') exprs = [audioExpr(f, 0), '0'];
  else if (f.channelMode === 'inverted') {
    const e = audioExpr(f, 0);
    exprs = [e, `-(${e})`];
  } else {
    exprs = [];
    for (let c = 0; c < f.channels; c++) exprs.push(audioExpr(f, c));
  }
  const layout = f.channels === 1 ? 'mono' : f.channels === 2 ? 'stereo' : f.channels === 6 ? '5.1' : `${f.channels}c`;
  const dur = f.audioDur ?? f.dur;
  return `aevalsrc=exprs='${exprs.join('|')}':s=${SR}:c=${layout}:d=${dur}`;
}

function fpsValue(fps) {
  const [n, d] = fps.split('/').map(Number);
  return d ? n / d : n;
}

function buildVideoFilter(f) {
  const fpsv = fpsValue(f.fps);
  const chain = [`color=c=0x303030:s=${f.w}x${f.h}:r=${f.fps}:d=${f.dur}`];
  for (const m of f.markers) {
    const n = Math.round(m * fpsv);
    chain.push(`drawbox=c=white:t=fill:enable='eq(n,${n})'`);
  }
  if (existsSync(FONT)) {
    const fontfile = FONT.replace(/\\/g, '/').replace(/:/g, '\\:');
    chain.push(`drawtext=fontfile='${fontfile}':text='%{n}':x=40:y=40:fontsize=${Math.max(24, Math.round(f.h / 12))}:fontcolor=0xEFE6D8`);
  }
  if (f.vfr) {
    // 前半 30fps、後半は 2 フレームに 1 枚落として 15fps 相当にする(VFR)
    chain.push(`select='if(lt(n,${Math.round(f.dur * fpsv) / 2}),1,not(mod(n,2)))'`);
  }
  return chain.join(',');
}

function encoderArgs(kind) {
  const dev = tools.kind === 'system-dev';
  switch (kind) {
    case 'h264':
      return dev ? ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'] : ['-c:v', 'h264_mf', '-hw_encoding', '0', '-pix_fmt', 'yuv420p'];
    case 'hevc':
      return dev ? ['-c:v', 'libx265', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'] : ['-c:v', 'hevc_mf', '-hw_encoding', '0', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'];
    case 'h264-10bit':
      return dev ? ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p10le'] : null;
    case 'h264-interlaced':
      return dev ? ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-flags', '+ildct+ilme', '-x264-params', 'interlaced=1', '-top', '1'] : null;
    case 'vp9':
      return ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p'];
    default:
      throw new Error(`unknown encoder ${kind}`);
  }
}

async function generate(f) {
  const ext = f.container === 'mkv' ? 'mkv' : 'mp4';
  const out = path.join(outDir, `${f.name}.${ext}`);
  if (existsSync(out) && !force) return { skipped: true, out };
  const enc = encoderArgs(f.encoder);
  if (!enc) return { unsupported: true, out };
  const tmp = `${out}.tmp.${ext}`;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-nostdin'];
  // video
  if (f.videoOffset) args.push('-itsoffset', String(f.videoOffset));
  args.push('-f', 'lavfi', '-i', buildVideoFilter(f));
  const audioSrc = buildAudioSource(f);
  if (f.extraSilentTrackFirst) {
    args.push('-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=stereo:d=${f.dur}`);
  }
  if (audioSrc) {
    if (f.audioOffset) args.push('-itsoffset', String(f.audioOffset));
    args.push('-f', 'lavfi', '-i', audioSrc);
  }
  args.push('-map', '0:v');
  if (f.extraSilentTrackFirst) args.push('-map', '1:a', '-map', '2:a', '-disposition:a:0', 'default', '-disposition:a:1', '0', '-metadata:s:a:1', 'handler_name=voice');
  else if (audioSrc) args.push('-map', `1:a`);
  args.push(...enc);
  // VFR と「映像が遅れて始まる(音声先行)」fixture は passthrough(cfr だと先頭が複製フレームで埋まり start_time が 0 になる)
  if (f.vfr || f.videoOffset) args.push('-fps_mode', 'passthrough');
  else args.push('-fps_mode', 'cfr');
  if (f.colorTags === 'pq') args.push('-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc');
  else args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
  if (audioSrc) args.push('-c:a', 'aac', '-b:a', '192k');
  if (f.encoder === 'vp9' && audioSrc) {
    args.splice(args.indexOf('-c:a'), 2, '-c:a', 'libopus');
    args.splice(args.indexOf('-b:a'), 2);
  }
  if (f.negativeTs) args.push('-output_ts_offset', `-${f.negativeTs}`, '-avoid_negative_ts', 'disabled');
  args.push('-movflags', '+faststart', '-t', String(Math.max(f.dur, f.audioDur ?? 0) + (f.videoOffset ?? 0) + (f.audioOffset ?? 0)), tmp);
  await run(tools.ffmpeg, args);
  if (f.displayRotation) {
    // 回転メタデータ(display matrix)を付与して remux
    const rotated = `${out}.rot.${ext}`;
    await run(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-nostdin', '-display_rotation', String(f.displayRotation), '-i', tmp, '-c', 'copy', '-movflags', '+faststart', rotated]);
    await run(process.platform === 'win32' ? 'cmd' : 'mv', process.platform === 'win32' ? ['/c', 'move', '/y', rotated, out] : [rotated, out]);
    await run(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'del', tmp] : [tmp]);
  } else {
    await run(process.platform === 'win32' ? 'cmd' : 'mv', process.platform === 'win32' ? ['/c', 'move', '/y', tmp, out] : [tmp, out]);
  }
  return { out };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const manifest = { generatedAt: new Date().toISOString(), tools: tools.kind, sampleRate: SR, fixtures: {} };
  const manifestPath = path.join(outDir, 'manifest.json');
  let previous = {};
  if (existsSync(manifestPath)) {
    try {
      previous = JSON.parse(await readFile(manifestPath, 'utf8')).fixtures ?? {};
    } catch {
      previous = {};
    }
  }
  for (const f of fixtures) {
    const started = Date.now();
    try {
      const r = await generate(f);
      if (r.unsupported) {
        process.stdout.write(`[fixtures] ${f.name}: unsupported on this host (skipped)\n`);
        continue;
      }
      const st = await stat(r.out);
      manifest.fixtures[f.name] = {
        file: path.basename(r.out),
        sizeBytes: st.size,
        width: f.w,
        height: f.h,
        fps: f.fps,
        durationSeconds: f.dur,
        channels: f.channels,
        speech: f.speech,
        quietDb: f.quietDb,
        markers: f.markers,
        encoder: f.encoder,
        displayRotation: f.displayRotation ?? 0,
        audioOffset: f.audioOffset ?? 0,
        videoOffset: f.videoOffset ?? 0,
        audioDur: f.audioDur ?? f.dur,
        negativeTs: f.negativeTs ?? 0,
        channelMode: f.channelMode ?? 'normal',
        vfr: !!f.vfr,
        extraSilentTrackFirst: !!f.extraSilentTrackFirst,
        container: f.container ?? 'mp4',
        colorTags: f.colorTags ?? 'bt709'
      };
      process.stdout.write(`[fixtures] ${f.name}: ${r.skipped ? 'exists' : 'generated'} (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
    } catch (e) {
      process.stdout.write(`[fixtures] ${f.name}: FAILED ${e.message.split('\n')[0]}\n`);
      if (previous[f.name]) manifest.fixtures[f.name] = previous[f.name];
    }
  }
  // 破損ファイル: 正常 mp4 の先頭 64KiB を切り出し + ランダムバイト
  const corruptPath = path.join(outDir, 'reject_corrupt.mp4');
  if (!existsSync(corruptPath) || force) {
    const src = path.join(outDir, 'fps60.mp4');
    if (existsSync(src)) {
      const buf = (await readFile(src)).subarray(0, 65536);
      for (let i = 4096; i < buf.length; i += 97) buf[i] = (buf[i] * 31 + 7) & 0xff;
      await writeFile(corruptPath, buf);
    }
  }
  if (existsSync(corruptPath)) manifest.fixtures['reject_corrupt'] = { file: 'reject_corrupt.mp4', corrupt: true };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`[fixtures] manifest written: ${path.relative(repoRoot, manifestPath)} (${Object.keys(manifest.fixtures).length} fixtures)\n`);
}

main().catch((e) => {
  process.stderr.write(`[fixtures] ERROR ${e.stack || e}\n`);
  process.exit(1);
});
