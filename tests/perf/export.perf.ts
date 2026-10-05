// 10 分 1080p の解析秒数 / 書き出し秒数 / ffmpeg の peak RSS を計測し、tests/perf/.result.json に記録する。
// 広告用の速度は Windows 実機での計測値だけを使う。この結果はホスト情報と共に TEST_REPORT へ転記する。
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { probeSource, defaultAudioTrack, colorPlanFor } from '@media/probe';
import { runAnalysis } from '@media/analysis';
import { planExport, runExport } from '@media/export';
import { verifyOutput } from '@media/verify';
import { encoderPlanFor } from '@media/encoder';
import { analyze } from '@domain/analysis';
import { settingsFromPreset } from '@domain/settings';
import { ensureWorkDir, tools, workerPath } from '../media/helpers';

const t = tools();
const work = ensureWorkDir();
const fixture = path.join(work, 'perf_10min_1080p30.mp4');

function peakRssSampler(): { stop: () => number } {
  let peak = 0;
  const timer = setInterval(() => {
    const r = spawnSync('ps', ['-o', 'rss=', '-C', 'ffmpeg'], { encoding: 'utf8' });
    for (const line of r.stdout.split('\n')) {
      const kb = Number(line.trim());
      if (Number.isFinite(kb)) peak = Math.max(peak, kb * 1024);
    }
  }, 500);
  return { stop: () => (clearInterval(timer), peak) };
}

function generateFixture(): void {
  if (existsSync(fixture)) return;
  mkdirSync(work, { recursive: true });
  // 発話 7 秒 / 無音 1.5 秒 を繰り返す 600 秒。ノイズ -20dBFS。
  const amp = (Math.pow(10, -20 / 20) * Math.sqrt(3)).toFixed(6);
  const expr = `${amp}*(2*random(0)-1)*lt(mod(t,8.5),7)`;
  const r = spawnSync(t.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=600', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}|${expr}':s=48000:c=stereo:d=600`, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '8M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', fixture], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('fixture generation failed');
}

describe('performance (10 min 1080p30)', () => {
  it('measures analysis / export seconds and peak RSS', async () => {
    generateFixture();
    const result: Record<string, unknown> = {
      host: { platform: process.platform, release: os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGiB: Math.round(os.totalmem() / 2 ** 30), node: process.version, tools: t.kind },
      note: 'Linux 開発環境の参考値。Windows 実機(h264_mf)での計測値ではないため広告には使わない。'
    };
    const t0 = Date.now();
    const info = await probeSource(t, fixture);
    result['probeSeconds'] = (Date.now() - t0) / 1000;
    const track = defaultAudioTrack(info.audioTracks)!;
    const s1 = peakRssSampler();
    const t1 = Date.now();
    const win = await runAnalysis({ workerPath, data: { ffmpeg: t.ffmpeg, file: fixture, audioStreamIndex: track.streamIndex, channels: track.channels, t0Us: info.firstVideoPtsUs, limitFrames: info.totalFrames } });
    result['analysisSeconds'] = (Date.now() - t1) / 1000;
    result['analysisPeakRssMB'] = Math.round(s1.stop() / 2 ** 20);
    const a = analyze(win.windowDb, settingsFromPreset('natural'), info.totalFrames);
    result['candidates'] = a.candidates.length;
    result['removedSeconds'] = (info.totalFrames - a.outputFrames) / 30;
    const cuts = a.cutRanges.map((c) => ({ startFrame: c.startFrame, endFrame: c.endFrame }));
    const out = path.join(work, 'perf_out.mp4');
    const script = path.join(work, 'perf_filters.txt');
    const inv = planExport({ inputFile: fixture, videoStreamIndex: info.videoStreamIndex, audioStreamIndex: track.streamIndex, t0Us: info.firstVideoPtsUs, totalFrames: info.totalFrames, cuts, displayWidth: info.displayWidth, displayHeight: info.displayHeight, channels: track.channels, color: colorPlanFor(info.colorInfo), outputPreset: '1080p30' }, encoderPlanFor(t.kind).variants[0]!, script, out);
    const s2 = peakRssSampler();
    const t2 = Date.now();
    await runExport(t, inv, script);
    result['exportSeconds'] = (Date.now() - t2) / 1000;
    result['exportPeakRssMB'] = Math.round(s2.stop() / 2 ** 20);
    result['encoder'] = inv.encoderLabel;
    const t3 = Date.now();
    const ver = await verifyOutput(t, out, inv.expectedFrames, inv.outWidth, inv.outHeight, track.channels);
    result['verifySeconds'] = (Date.now() - t3) / 1000;
    result['verificationOk'] = ver.ok;
    result['outputFrames'] = inv.expectedFrames;
    result['measuredAt'] = new Date().toISOString();
    writeFileSync(path.join(__dirname, '.result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    expect(ver.ok).toBe(true);
    expect(readFileSync(path.join(__dirname, '.result.json'), 'utf8')).toContain('exportSeconds');
  });
});
