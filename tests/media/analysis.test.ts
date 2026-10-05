import { describe, expect, it } from 'vitest';
import { runAnalysis } from '@media/analysis';
import { probeSource, defaultAudioTrack } from '@media/probe';
import { analyze } from '@domain/analysis';
import { findQuietRuns } from '@domain/rms';
import { settingsFromPreset } from '@domain/settings';
import { expectedQuietRunsMs, fixturePath, loadManifest, tools, workerPath } from './helpers';

const t = tools();
const manifest = loadManifest();

async function windowsFor(name: string, limitFrames?: number) {
  const file = fixturePath(name);
  const info = await probeSource(t, file);
  const track = defaultAudioTrack(info.audioTracks)!;
  const result = await runAnalysis({
    workerPath,
    data: { ffmpeg: t.ffmpeg, file, audioStreamIndex: track.streamIndex, channels: track.channels, t0Us: info.firstVideoPtsUs, limitFrames: limitFrames ?? info.totalFrames }
  });
  return { info, track, result };
}

/** run 境界の比較(±1 窓 = 20ms の許容。ノイズ発話の最初/最後の窓は部分的に埋まる) */
function expectRunsClose(actual: Array<{ startMs: number; endMs: number }>, expected: Array<{ startMs: number; endMs: number }>, tolMs = 40) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual[i]!.startMs - expected[i]!.startMs)).toBeLessThanOrEqual(tolMs);
    expect(Math.abs(actual[i]!.endMs - expected[i]!.endMs)).toBeLessThanOrEqual(tolMs);
  }
}

describe('RMS analysis worker', () => {
  it('landscape: windows cover N*1600 samples, quiet runs match the fixture, [10,12) → [305,355)', async () => {
    const { info, result } = await windowsFor('landscape_1080p30_stereo');
    expect(result.windowDb.length).toBe(Math.ceil((info.totalFrames * 1600) / 960));
    const runs = findQuietRuns(result.windowDb, -35);
    const expected = expectedQuietRunsMs(manifest['landscape_1080p30_stereo']!, 40_000);
    // 発話中にビープ(マーカー)があるが quiet にはならない
    expectRunsClose(runs, expected);
    const a = analyze(result.windowDb, settingsFromPreset('natural'), info.totalFrames);
    expect(a.state).toBe('ok');
    const main = a.cutRanges.find((c) => c.startFrame === 305);
    expect(main).toBeDefined();
    expect(main!.endFrame).toBe(355);
    // 780ms の run は候補にならず、800ms ちょうど [25.0,25.8) は候補になる(余白 150+150 → [25.15,25.65) → [755,769))
    expect(a.cutRanges.some((c) => c.startFrame >= 598 && c.endFrame <= 626)).toBe(false);
    expect(a.cutRanges.some((c) => c.startFrame === 755 && c.endFrame === 769)).toBe(true);
    // 先頭 [0,1.5) と末尾 [37,40) も同じ規則で候補
    expect(a.cutRanges[0]).toMatchObject({ startFrame: 5, endFrame: 40 });
    expect(a.cutRanges[a.cutRanges.length - 1]).toMatchObject({ startFrame: 1115, endFrame: 1195 });
  });
  it('left-only speech and inverted-phase stereo are NOT misdetected as silence', async () => {
    for (const name of ['left_only', 'inverted_phase']) {
      const { result } = await windowsFor(name);
      const runs = findQuietRuns(result.windowDb, -35);
      expectRunsClose(runs, expectedQuietRunsMs(manifest[name]!, 12_000));
    }
  });
  it('faint voice (-42 dBFS) is quiet at -35 but kept at -45', async () => {
    const { result } = await windowsFor('faint_voice');
    expect(findQuietRuns(result.windowDb, -35)).toHaveLength(1); // 全体が quiet
    const runsLow = findQuietRuns(result.windowDb, -45);
    expectRunsClose(runsLow, expectedQuietRunsMs(manifest['faint_voice']!, 12_000));
  });
  it('constant BGM at -30 dBFS hides silences at -35 (documented limitation) but not at -25', async () => {
    const { result } = await windowsFor('constant_bgm');
    expect(findQuietRuns(result.windowDb, -35)).toHaveLength(0);
    expectRunsClose(findQuietRuns(result.windowDb, -25), expectedQuietRunsMs(manifest['constant_bgm']!, 12_000));
  });
  it('a cough inside a gap splits the run into two', async () => {
    const { result } = await windowsFor('cough_in_gap');
    const runs = findQuietRuns(result.windowDb, -35);
    expectRunsClose(runs, expectedQuietRunsMs(manifest['cough_in_gap']!, 12_000));
    expect(runs).toHaveLength(2);
  });
  it('all quiet → all-quiet state; all voice → no candidates', async () => {
    const q = await windowsFor('all_quiet');
    expect(analyze(q.result.windowDb, settingsFromPreset('natural'), q.info.totalFrames).state).toBe('all-quiet');
    const v = await windowsFor('all_voice');
    expect(analyze(v.result.windowDb, settingsFromPreset('natural'), v.info.totalFrames).state).toBe('no-candidates');
  });
  it('analysis zero point equals the video zero point (audio +200ms delay fixture)', async () => {
    // 音声が 200ms 遅れて始まる。T0 基準の時刻では発話 [0,6) は [0.2,6.2) に現れ、先頭 0.2s は無音でパディングされる。
    const { result } = await windowsFor('audio_delay_200ms');
    const runs = findQuietRuns(result.windowDb, -35);
    expect(runs[0]!.startMs).toBe(0);
    expect(Math.abs(runs[0]!.endMs - 200)).toBeLessThanOrEqual(40);
    // 中央の無音 [6,8) は [6.2,8.2) に現れる
    const mid = runs.find((r) => r.startMs > 5000 && r.startMs < 7000)!;
    expect(Math.abs(mid.startMs - 6200)).toBeLessThanOrEqual(40);
    expect(Math.abs(mid.endMs - 8200)).toBeLessThanOrEqual(40);
  });
  it('audio lead: video T0 later than audio → leading audio trimmed', async () => {
    const { result } = await windowsFor('audio_lead_150ms');
    const runs = findQuietRuns(result.windowDb, -35);
    const mid = runs.find((r) => r.startMs > 5000 && r.startMs < 7000)!;
    // 音声は T0 より 150ms 早く始まる → 無音 [6,8) は [5.85,7.85) に現れる
    expect(Math.abs(mid.startMs - 5850)).toBeLessThanOrEqual(40);
    expect(Math.abs(mid.endMs - 7850)).toBeLessThanOrEqual(40);
  });
  it('short audio: tail is padded with silence', async () => {
    const { info, result } = await windowsFor('short_audio');
    expect(result.windowDb.length).toBe(Math.ceil((info.totalFrames * 1600) / 960));
    const runs = findQuietRuns(result.windowDb, -35);
    const last = runs[runs.length - 1]!;
    expect(Math.abs(last.startMs - 17000)).toBeLessThanOrEqual(40);
    expect(last.endMs).toBe(result.windowDb.length * 20);
  });
  it('two audio tracks: the silent default track yields all-quiet, the voice track yields candidates', async () => {
    const file = fixturePath('two_audio_tracks');
    const info = await probeSource(t, file);
    const silent = await runAnalysis({ workerPath, data: { ffmpeg: t.ffmpeg, file, audioStreamIndex: 1, channels: 2, t0Us: info.firstVideoPtsUs, limitFrames: info.totalFrames } });
    expect(analyze(silent.windowDb, settingsFromPreset('natural'), info.totalFrames).state).toBe('all-quiet');
    const voice = await runAnalysis({ workerPath, data: { ffmpeg: t.ffmpeg, file, audioStreamIndex: 2, channels: 2, t0Us: info.firstVideoPtsUs, limitFrames: info.totalFrames } });
    expect(analyze(voice.windowDb, settingsFromPreset('natural'), info.totalFrames).state).toBe('ok');
  });
  it('limitFrames (DEMO 90s gate) clips the analysis to the first frames', async () => {
    const { result } = await windowsFor('landscape_1080p30_stereo', 300);
    expect(result.windowDb.length).toBe(500); // 300*1600/960
    expect(result.analyzedFrames).toBe(300);
  });
  it('cancel aborts the worker', async () => {
    const file = fixturePath('landscape_1080p30_stereo');
    const info = await probeSource(t, file);
    const ac = new AbortController();
    const p = runAnalysis({ workerPath, signal: ac.signal, data: { ffmpeg: t.ffmpeg, file, audioStreamIndex: 1, channels: 2, t0Us: 0, limitFrames: info.totalFrames } });
    setTimeout(() => ac.abort(), 30);
    await expect(p).rejects.toMatchObject({ code: 'E_CANCELLED' });
  });
});
