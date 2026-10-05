import { describe, expect, it } from 'vitest';
import { probeSource, defaultAudioTrack, validateAudioTrack } from '@media/probe';
import { AppError } from '@shared/errors';
import { fixturePath, hasFixture, loadManifest, tools } from './helpers';

const t = tools();
const manifest = loadManifest();

async function expectReject(name: string, code: string, messageIncludes?: string) {
  if (!hasFixture(name)) return;
  const err = await probeSource(t, fixturePath(name)).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  const ae = err as AppError;
  expect(ae.code).toBe(code);
  if (messageIncludes) expect(ae.message).toContain(messageIncludes);
}

describe('probeSource: accepted formats', () => {
  it('landscape 1080p30 stereo: T0=0, D=40s, N=1200, no rotation', async () => {
    const info = await probeSource(t, fixturePath('landscape_1080p30_stereo'));
    expect(info.codec).toBe('h264');
    expect(info.displayWidth).toBe(1920);
    expect(info.displayHeight).toBe(1080);
    expect(info.rotation).toBe(0);
    expect(info.firstVideoPtsUs).toBe(0);
    expect(info.durationUs).toBe(40_000_000);
    expect(info.totalFrames).toBe(1200);
    expect(info.videoPacketCount).toBe(1200);
    expect(info.isVfr).toBe(false);
    expect(info.audioTracks).toHaveLength(1);
    expect(info.audioTracks[0]!.channels).toBe(2);
    expect(info.colorInfo.assumedBt709).toBe(false);
  });
  it('portrait rotation metadata → display 1080×1920', async () => {
    const info = await probeSource(t, fixturePath('portrait_rotate90'));
    expect(info.rotation === 90 || info.rotation === 270).toBe(true);
    expect(info.displayWidth).toBe(1080);
    expect(info.displayHeight).toBe(1920);
    expect(info.codedWidth).toBe(1920);
  });
  it('25fps mono 720p accepted, N = ceil(20*30) = 600', async () => {
    const info = await probeSource(t, fixturePath('p720_25fps_mono'));
    expect(info.frameRateNum / info.frameRateDen).toBeCloseTo(25, 6);
    expect(info.totalFrames).toBe(600);
    expect(info.audioTracks[0]!.channels).toBe(1);
  });
  it('29.97 / 50 / 59.94 / 60 fps accepted', async () => {
    for (const name of ['fps2997', 'fps50', 'fps5994', 'fps60']) {
      const info = await probeSource(t, fixturePath(name));
      expect(info.totalFrames).toBe(Math.ceil(manifest[name]!.durationSeconds * 30));
    }
  });
  it('VFR detected and accepted', async () => {
    const info = await probeSource(t, fixturePath('vfr'));
    expect(info.isVfr).toBe(true);
    expect(info.warnings.some((w) => w.includes('可変フレームレート'))).toBe(true);
  });
  it('audio delay / audio lead keep a video-based T0 and D', async () => {
    const delayed = await probeSource(t, fixturePath('audio_delay_200ms'));
    expect(delayed.firstVideoPtsUs).toBe(0);
    expect(delayed.totalFrames).toBe(600);
    expect(delayed.audioTracks[0]!.startTimeUs).toBeGreaterThan(100_000);
    const lead = await probeSource(t, fixturePath('audio_lead_150ms'));
    // 映像が 150ms 遅れて始まる → T0 = 0.15s(元ファイルのタイムライン)
    expect(lead.firstVideoPtsUs).toBeGreaterThanOrEqual(140_000);
    expect(lead.firstVideoPtsUs).toBeLessThanOrEqual(170_000);
    expect(lead.totalFrames).toBe(600);
  });
  it('negative/edit-list PTS: discard packets are ignored, T0 is the first displayed frame', async () => {
    const info = await probeSource(t, fixturePath('negative_pts'));
    expect(info.firstVideoPtsUs).toBe(0);
    expect(info.durationUs).toBe(11_500_000);
    expect(info.totalFrames).toBe(345);
  });
  it('HEVC 8bit accepted with a slow-conversion warning', async () => {
    const info = await probeSource(t, fixturePath('hevc_8bit'));
    expect(info.codec).toBe('hevc');
    expect(info.warnings.some((w) => w.includes('HEVC'))).toBe(true);
  });
  it('two audio tracks: default track proposed, selection required by UI', async () => {
    const info = await probeSource(t, fixturePath('two_audio_tracks'));
    expect(info.audioTracks).toHaveLength(2);
    const def = defaultAudioTrack(info.audioTracks)!;
    expect(def.isDefault).toBe(true);
    expect(def.streamIndex).toBe(1);
    expect(info.audioTracks[1]!.title).toBe('voice'); // MP4 では handler_name に入る
    for (const tr of info.audioTracks) expect(() => validateAudioTrack(tr)).not.toThrow();
  });
});

describe('probeSource: rejected formats (E_FORMAT etc.)', () => {
  it('no audio → E_NO_AUDIO', () => expectReject('no_audio', 'E_NO_AUDIO'));
  it('HDR PQ tags → E_FORMAT', () => expectReject('reject_hdr_pq_tags', 'E_FORMAT', 'HDR'));
  it('10bit → E_FORMAT', () => expectReject('reject_10bit', 'E_FORMAT', '10bit'));
  it('interlaced → E_FORMAT', () => expectReject('reject_interlaced', 'E_FORMAT', 'インターレース'));
  it('4K → E_TOO_BIG_FRAME', () => expectReject('reject_4k', 'E_TOO_BIG_FRAME'));
  it('MKV container → E_FORMAT', () => expectReject('reject_mkv', 'E_FORMAT', 'コンテナ'));
  it('VP9 codec → E_FORMAT', () => expectReject('reject_vp9', 'E_FORMAT'));
  it('corrupt file → E_FORMAT', () => expectReject('reject_corrupt', 'E_FORMAT'));
  it('6ch audio → validateAudioTrack throws E_FORMAT', async () => {
    const info = await probeSource(t, fixturePath('reject_6ch'));
    expect(() => validateAudioTrack(info.audioTracks[0]!)).toThrow(/チャンネル数/);
  });
});
