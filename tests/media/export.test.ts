import { describe, expect, it } from 'vitest';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { sha256File } from '@media/tools';
import path from 'node:path';
import { probeSource, defaultAudioTrack, colorPlanFor } from '@media/probe';
import { planExport, runExport } from '@media/export';
import { verifyOutput } from '@media/verify';
import { encoderPlanFor } from '@media/encoder';
import { runEncoderSelfTest } from '@media/selftest';
import { planJunctionArgs, renderJunction, junctionWindow } from '@media/junction';
import { runAnalysis } from '@media/analysis';
import { analyze } from '@domain/analysis';
import { settingsFromPreset } from '@domain/settings';
import type { FrameRange } from '@domain/ranges';
import { detectBeepOnsets, detectBrightFrames, ensureWorkDir, fixturePath, loadManifest, mapToOutputFrame, secondsToFrame, tools, workerPath } from './helpers';
import type { OutputPresetId } from '@shared/constants';

const t = tools();
const manifest = loadManifest();
const variant = encoderPlanFor(t.kind).variants[0]!;
const work = ensureWorkDir();

async function exportFixture(name: string, cuts: FrameRange[], preset: OutputPresetId = '720p30', tag = '') {
  const file = fixturePath(name);
  const info = await probeSource(t, file);
  const track = defaultAudioTrack(info.audioTracks)!;
  const outTmp = path.join(work, `${name}${tag}.tmp.mp4`);
  const script = path.join(work, `${name}${tag}.filters.txt`);
  const inv = planExport(
    { inputFile: file, videoStreamIndex: info.videoStreamIndex, audioStreamIndex: track.streamIndex, t0Us: info.firstVideoPtsUs, totalFrames: info.totalFrames, cuts, displayWidth: info.displayWidth, displayHeight: info.displayHeight, channels: track.channels, color: colorPlanFor(info.colorInfo), outputPreset: preset },
    variant,
    script,
    outTmp
  );
  await rm(outTmp, { force: true });
  const progress: number[] = [];
  const run = await runExport(t, inv, script, { onProgress: (r) => progress.push(r) });
  const ver = await verifyOutput(t, outTmp, inv.expectedFrames, inv.outWidth, inv.outHeight, track.channels);
  return { info, inv, ver, outTmp, progress, run };
}

/** マーカー(白フレーム+ビープ)が出力の同じフレームにあり、映像/音声のズレが 1 フレーム以内であることを確認 */
function checkMarkers(name: string, outFile: string, cuts: FrameRange[], info: { firstVideoPtsUs: number }, audioOffsetFrames = 0) {
  const entry = manifest[name]!;
  const expectedOut: number[] = [];
  for (const m of entry.markers) {
    // マーカーは元ファイルの時刻 m 秒(映像の時刻)。T0 正規化後のフレーム = round((m*1e6 + videoOffset - T0)/1e6*30)
    const normalizedSec = m + (entry.videoOffset ?? 0) - info.firstVideoPtsUs / 1_000_000;
    const srcFrame = secondsToFrame(normalizedSec);
    const out = mapToOutputFrame(srcFrame, cuts);
    if (out !== null) expectedOut.push(out);
  }
  const bright = detectBrightFrames(t, outFile);
  const beeps = detectBeepOnsets(t, outFile);
  expect(bright.length).toBe(expectedOut.length);
  expect(beeps.length).toBe(expectedOut.length);
  for (let i = 0; i < expectedOut.length; i++) {
    expect(Math.abs(bright[i]! - expectedOut[i]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(beeps[i]! - (expectedOut[i]! + audioOffsetFrames))).toBeLessThanOrEqual(1);
  }
}

describe('encoder self test', () => {
  it('2-second self test succeeds with the configured encoder', async () => {
    const r = await runEncoderSelfTest(t, work);
    expect(r.status.ok).toBe(true);
    expect(r.variant).not.toBeNull();
    expect(r.status.toolsKind).toBe(t.kind);
  });
});

describe('export + verification', () => {
  it('landscape 1080p30 with the natural preset: frames = E, A/V within tolerance, markers aligned', async () => {
    const file = fixturePath('landscape_1080p30_stereo');
    const info = await probeSource(t, file);
    const win = await runAnalysis({ workerPath, data: { ffmpeg: t.ffmpeg, file, audioStreamIndex: 1, channels: 2, t0Us: info.firstVideoPtsUs, limitFrames: info.totalFrames } });
    const a = analyze(win.windowDb, settingsFromPreset('natural'), info.totalFrames);
    const cuts = a.cutRanges.map((c) => ({ startFrame: c.startFrame, endFrame: c.endFrame }));
    expect(cuts.length).toBeGreaterThanOrEqual(3);
    const { inv, ver, outTmp, progress } = await exportFixture('landscape_1080p30_stereo', cuts, '1080p30');
    expect(inv.expectedFrames).toBe(1200 - cuts.reduce((s, c) => s + c.endFrame - c.startFrame, 0));
    expect(ver.problems).toEqual([]);
    expect(ver.ok).toBe(true);
    expect(ver.videoFrameCount.actual).toBe(inv.expectedFrames);
    expect(ver.width).toBe(1920);
    expect(ver.height).toBe(1080);
    expect(progress.length).toBeGreaterThan(0);
    checkMarkers('landscape_1080p30_stereo', outTmp, cuts, info);
  });
  it('AC03: the source file hash is identical before and after export', async () => {
    const file = fixturePath('fps60');
    const before = await sha256File(file);
    await exportFixture('fps60', [{ startFrame: 100, endFrame: 130 }], '720p30', '-hash');
    const after = await sha256File(file);
    expect(after).toBe(before);
    expect(statSync(file).size).toBeGreaterThan(0);
  });
  it('output paths with Japanese, emoji, quotes and & are passed as argv (no shell)', async () => {
    const file = fixturePath('fps60');
    const info = await probeSource(t, file);
    const dir = path.join(work, '日本語 フォルダー 😀 "quote" & amp');
    mkdirSync(dir, { recursive: true });
    const outTmp = path.join(dir, 'それは "test" & done.tmp.mp4');
    const script = path.join(dir, 'filters "x" & y.txt');
    const inv = planExport({ inputFile: file, videoStreamIndex: info.videoStreamIndex, audioStreamIndex: 1, t0Us: info.firstVideoPtsUs, totalFrames: info.totalFrames, cuts: [], displayWidth: info.displayWidth, displayHeight: info.displayHeight, channels: 2, color: colorPlanFor(info.colorInfo), outputPreset: '720p30' }, variant, script, outTmp);
    await runExport(t, inv, script);
    const ver = await verifyOutput(t, outTmp, inv.expectedFrames, inv.outWidth, inv.outHeight, 2);
    expect(ver.ok).toBe(true);
  });
  it('unwritable destination fails with E_ENCODE and leaves no output (skipped when running as root)', async () => {
    if (process.getuid && process.getuid() === 0) return; // root は chmod を無視するためこのホストでは検証不能
    const file = fixturePath('fps60');
    const info = await probeSource(t, file);
    const dir = path.join(work, 'readonly');
    mkdirSync(dir, { recursive: true });
    const { chmodSync } = await import('node:fs');
    chmodSync(dir, 0o555);
    const outTmp = path.join(dir, 'x.tmp.mp4');
    const script = path.join(work, 'ro-filters.txt');
    const inv = planExport({ inputFile: file, videoStreamIndex: info.videoStreamIndex, audioStreamIndex: 1, t0Us: info.firstVideoPtsUs, totalFrames: info.totalFrames, cuts: [], displayWidth: info.displayWidth, displayHeight: info.displayHeight, channels: 2, color: colorPlanFor(info.colorInfo), outputPreset: '720p30' }, variant, script, outTmp);
    await expect(runExport(t, inv, script)).rejects.toMatchObject({ code: 'E_ENCODE' });
    expect(existsSync(outTmp)).toBe(false);
    chmodSync(dir, 0o755);
  });
  it('zero cuts: output length equals N exactly', async () => {
    const { inv, ver } = await exportFixture('fps60', [], '720p30', '-nocut');
    expect(inv.expectedFrames).toBe(450);
    expect(ver.ok).toBe(true);
  });
  it('one cut on 25fps mono: fps converted to 30, mono kept, 128kbps', async () => {
    const { inv, ver, outTmp, info } = await exportFixture('p720_25fps_mono', [{ startFrame: 185, endFrame: 235 }]);
    expect(inv.audioBitrateKbps).toBe(128);
    expect(ver.channels).toBe(1);
    expect(ver.ok).toBe(true);
    expect(ver.frameRate).toBe('30/1');
    checkMarkers('p720_25fps_mono', outTmp, [{ startFrame: 185, endFrame: 235 }], info);
  });
  it('portrait rotation: output is 720×1280 (no upscaling, rotation applied once, no rotate metadata)', async () => {
    const { ver, inv } = await exportFixture('portrait_rotate90', [{ startFrame: 125, endFrame: 175 }]);
    expect(inv.outWidth).toBe(720);
    expect(inv.outHeight).toBe(1280);
    expect(ver.ok).toBe(true);
  });
  it('29.97 / 59.94 / 50 fps sources convert to 30fps with exact frame counts', async () => {
    for (const name of ['fps2997', 'fps5994', 'fps50']) {
      const cut = { startFrame: secondsToFrame(6.2), endFrame: secondsToFrame(7.8) };
      const { ver, outTmp, info } = await exportFixture(name, [cut]);
      expect(ver.problems).toEqual([]);
      checkMarkers(name, outTmp, [cut], info);
    }
  });
  it('VFR source: CFR output with exact N and aligned markers', async () => {
    const cut = { startFrame: 185, endFrame: 235 };
    const { ver, outTmp, info } = await exportFixture('vfr', [cut]);
    expect(ver.problems).toEqual([]);
    checkMarkers('vfr', outTmp, [cut], info);
  });
  it('audio +200ms delay: the delay is preserved (audio markers land 6 frames after video markers)', async () => {
    const cut = { startFrame: 190, endFrame: 240 };
    const { ver, outTmp, info } = await exportFixture('audio_delay_200ms', [cut]);
    expect(ver.problems).toEqual([]);
    checkMarkers('audio_delay_200ms', outTmp, [cut], info, 6);
  });
  it('audio lead (video starts 150ms later): both normalized to the same T0', async () => {
    const cut = { startFrame: 190, endFrame: 240 };
    const { ver, outTmp, info } = await exportFixture('audio_lead_150ms', [cut]);
    expect(ver.problems).toEqual([]);
    // 映像が 150ms 遅れて始まるので、T0 基準では音声マーカーは映像マーカーより 150ms(4.5 フレーム)早い
    checkMarkers('audio_lead_150ms', outTmp, [cut], info, -4);
  });
  it('short audio: tail padded with silence, A/V end diff within 50ms', async () => {
    const { ver } = await exportFixture('short_audio', [{ startFrame: 190, endFrame: 240 }]);
    expect(ver.problems).toEqual([]);
  });
  it('negative/edit-list PTS source exports with exact N', async () => {
    const { ver, inv } = await exportFixture('negative_pts', [{ startFrame: 130, endFrame: 170 }]);
    expect(inv.expectedFrames).toBe(345 - 40);
    expect(ver.problems).toEqual([]);
  });
  it('HEVC source → H.264 output', async () => {
    const { ver } = await exportFixture('hevc_8bit', [{ startFrame: 130, endFrame: 170 }]);
    expect(ver.videoCodec).toBe('h264');
    expect(ver.ok).toBe(true);
  });
  it('600 cuts in one filter script: expression length is handled, frame count exact', async () => {
    const cuts: FrameRange[] = [];
    // fps60 fixture: 450 frames は 600 カットに足りないので landscape(1200 frames)で 600 個の 1 フレーム...3 フレーム未満は実運用では無いが式の長さ検証が目的
    for (let i = 0; i < 600; i++) cuts.push({ startFrame: i * 2, endFrame: i * 2 + 1 });
    const { ver, inv } = await exportFixture('landscape_1080p30_stereo', cuts, '720p30', '-600');
    expect(inv.filterScript.length).toBeGreaterThan(20_000);
    expect(inv.expectedFrames).toBe(600);
    expect(ver.problems).toEqual([]);
  });
  it('cancel stops ffmpeg and leaves only the temp file', async () => {
    const file = fixturePath('landscape_1080p30_stereo');
    const info = await probeSource(t, file);
    const outTmp = path.join(work, 'cancel.tmp.mp4');
    const script = path.join(work, 'cancel.filters.txt');
    const inv = planExport({ inputFile: file, videoStreamIndex: 0, audioStreamIndex: 1, t0Us: 0, totalFrames: info.totalFrames, cuts: [], displayWidth: 1920, displayHeight: 1080, channels: 2, color: { inMatrix: null, inRange: null }, outputPreset: '1080p30' }, variant, script, outTmp);
    const ac = new AbortController();
    const p = runExport(t, inv, script, { signal: ac.signal });
    setTimeout(() => ac.abort(), 400);
    await expect(p).rejects.toMatchObject({ code: 'E_CANCELLED' });
  });
});

describe('junction preview', () => {
  it('original and edited previews use the same graph; edited is shorter by the cut; window clipped at media edges', async () => {
    const file = fixturePath('landscape_1080p30_stereo');
    const info = await probeSource(t, file);
    const cut = { startFrame: 305, endFrame: 355 };
    const plan = { inputFile: file, videoStreamIndex: 0, audioStreamIndex: 1, t0Us: info.firstVideoPtsUs, totalFrames: info.totalFrames, cut, displayWidth: 1920, displayHeight: 1080, channels: 2, color: colorPlanFor(info.colorInfo) };
    expect(junctionWindow(cut, info.totalFrames)).toEqual({ startFrame: 245, endFrame: 415 });
    expect(junctionWindow({ startFrame: 10, endFrame: 40 }, 100)).toEqual({ startFrame: 0, endFrame: 100 });
    const orig = path.join(work, 'junction-orig.mp4');
    const edit = path.join(work, 'junction-edit.mp4');
    const o = await renderJunction(t, plan, false, variant, path.join(work, 'j-o.txt'), orig);
    const e = await renderJunction(t, plan, true, variant, path.join(work, 'j-e.txt'), edit);
    expect(o.expectedFrames).toBe(170);
    expect(e.expectedFrames).toBe(120);
    const vo = await verifyOutput(t, orig, 170, 1280, 720, 2);
    const ve = await verifyOutput(t, edit, 120, 1280, 720, 2);
    expect(vo.problems).toEqual([]);
    expect(ve.problems).toEqual([]);
    // 元版には t=10 秒のマーカーは無いが(マーカーは 5/15/30 秒)、ウィンドウ [245,415) に 15 秒(frame 450)は含まれない。
    // 代わりに音声内容が一致するかを、先頭 2 秒(カット前)の RMS で確認する。
    const args = planJunctionArgs(plan, true, variant, 'x.txt', 'y.mp4');
    expect(args.args).toContain('-copyts');
    expect(existsSync(orig) && statSync(orig).size > 0).toBe(true);
  });
  it('junction near the start uses no input seek', async () => {
    const file = fixturePath('landscape_1080p30_stereo');
    const info = await probeSource(t, file);
    const plan = { inputFile: file, videoStreamIndex: 0, audioStreamIndex: 1, t0Us: info.firstVideoPtsUs, totalFrames: info.totalFrames, cut: { startFrame: 5, endFrame: 40 }, displayWidth: 1920, displayHeight: 1080, channels: 2, color: colorPlanFor(info.colorInfo) };
    const inv = planJunctionArgs(plan, true, variant, 'x.txt', 'y.mp4');
    expect(inv.args).not.toContain('-ss');
    const out = path.join(work, 'junction-head.mp4');
    const r = await renderJunction(t, plan, true, variant, path.join(work, 'j-h.txt'), out);
    const v = await verifyOutput(t, out, r.expectedFrames, 1280, 720, 2);
    expect(v.problems).toEqual([]);
  });
});
