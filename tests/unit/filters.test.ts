import { describe, expect, it } from 'vitest';
import { buildAudioChain, buildKeepExpression, buildVideoChain, fitOutputSize, validateCuts } from '@media/filters';
import { planExport } from '@media/export';
import { encoderPlanFor } from '@media/encoder';
import { maskPaths } from '@media/process';
import { rotationOf, tbToUs, colorPlanFor } from '@media/probe';

describe('filter builder', () => {
  it('keep expression uses between(n,a,b-1) and not()', () => {
    expect(buildKeepExpression([])).toBe('1');
    expect(buildKeepExpression([{ startFrame: 305, endFrame: 355 }])).toBe('not(between(n,305,354))');
    expect(buildKeepExpression([{ startFrame: 10, endFrame: 20 }, { startFrame: 30, endFrame: 33 }], 5)).toBe('not(between(n,5,14)+between(n,25,27))');
    expect(buildKeepExpression([{ startFrame: 10, endFrame: 20 }], 0, { start: 0, end: 100 })).toBe('not(between(n,10,19))*between(n,0,99)');
  });
  it('rejects non-integer or out-of-range cuts', () => {
    expect(() => validateCuts([{ startFrame: 1.5, endFrame: 3 }], 100)).toThrow();
    expect(() => validateCuts([{ startFrame: 5, endFrame: 5 }], 100)).toThrow();
    expect(() => validateCuts([{ startFrame: 5, endFrame: 101 }], 100)).toThrow();
    expect(validateCuts([{ startFrame: 5, endFrame: 10 }, { startFrame: 10, endFrame: 12 }], 100)).toEqual([{ startFrame: 5, endFrame: 12 }]);
  });
  it('video chain normalizes T0, fps 30, tpad/trim to N, select, scale, sar', () => {
    const chain = buildVideoChain({ inputLabel: '0:0', t0Us: 33367, totalFrames: 1800, cuts: [{ startFrame: 305, endFrame: 355 }], outWidth: 1920, outHeight: 1080, color: { inMatrix: null, inRange: null }, outputLabel: 'vout' });
    expect(chain).toBe("[0:0]setpts=PTS-33367/1000000/TB,fps=fps=30:start_time=0:round=near,tpad=stop=-1:stop_mode=clone,trim=end_frame=1800,setpts=N/(30*TB),select='not(between(n,305,354))',setpts=N/(30*TB),scale=1920:1080:flags=bicubic:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p[vout]");
  });
  it('audio chain uses the same T0 and N*1600 samples', () => {
    const chain = buildAudioChain({ inputLabel: '0:1', t0Us: -500000, totalFrames: 1800, cuts: [{ startFrame: 305, endFrame: 355 }], outputLabel: 'aout' });
    expect(chain).toBe("[0:1]asetpts=PTS+500000/1000000/TB,aresample=48000:async=1:first_pts=0,apad=whole_len=2880000,atrim=end_sample=2880000,asetnsamples=n=1600:p=1,aselect='not(between(n,305,354))',asetpts=N/SR/TB[aout]");
  });
  it('windowed chain (junction) shifts n by start and limits the window', () => {
    const chain = buildVideoChain({ inputLabel: '0:0', t0Us: 0, totalFrames: 1800, cuts: [{ startFrame: 305, endFrame: 355 }], outWidth: 1280, outHeight: 720, color: { inMatrix: 'smpte170m', inRange: 'pc' }, startFrame: 245, windowEndFrame: 415, outputLabel: 'vout' });
    expect(chain).toContain('fps=fps=30:start_time=8.166666667:round=near');
    expect(chain).toContain('trim=end_frame=1555');
    expect(chain).toContain("select='not(between(n,60,109))*between(n,0,169)'");
    expect(chain).toContain('in_color_matrix=smpte170m');
    expect(chain).toContain('in_range=pc');
  });
  it('rejects odd output size', () => {
    expect(() => buildVideoChain({ inputLabel: '0:0', t0Us: 0, totalFrames: 10, cuts: [], outWidth: 1279, outHeight: 720, color: { inMatrix: null, inRange: null }, outputLabel: 'v' })).toThrow();
  });
  it('fitOutputSize keeps aspect, never upscales, rounds to even', () => {
    expect(fitOutputSize(1920, 1080, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(fitOutputSize(1080, 1920, 1920, 1080)).toEqual({ width: 1080, height: 1920 });
    expect(fitOutputSize(1280, 720, 1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(fitOutputSize(1920, 1080, 1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(fitOutputSize(1080, 1920, 1280, 720)).toEqual({ width: 720, height: 1280 });
    expect(fitOutputSize(1440, 1080, 1280, 720)).toEqual({ width: 960, height: 720 });
    expect(fitOutputSize(853, 480, 1920, 1080)).toEqual({ width: 854, height: 480 });
  });
  it('planExport builds a shell-free argv with script path and expected frames', () => {
    const variant = encoderPlanFor('system-dev').variants[0]!;
    const inv = planExport(
      { inputFile: '/in/a b.mp4', videoStreamIndex: 0, audioStreamIndex: 1, t0Us: 0, totalFrames: 1800, cuts: [{ startFrame: 305, endFrame: 355 }], displayWidth: 1920, displayHeight: 1080, channels: 2, color: { inMatrix: null, inRange: null }, outputPreset: '1080p30' },
      variant,
      '/tmp/f.txt',
      '/out/x.tmp.mp4'
    );
    expect(inv.expectedFrames).toBe(1750);
    expect(inv.args).toContain('-filter_complex_script');
    expect(inv.args).toContain('/in/a b.mp4');
    expect(inv.args.some((a) => a.includes('&&') || a.includes('|'))).toBe(false);
    expect(inv.audioBitrateKbps).toBe(192);
    expect(inv.videoBitrateKbps).toBe(12000);
    expect(inv.args).toContain('passthrough');
  });
  it('h264_mf plan uses software mode and never a different codec', () => {
    const plan = encoderPlanFor('bundled-win32');
    expect(plan.encoderName).toBe('h264_mf');
    for (const v of plan.variants) {
      const args = v.args(12000, 15000);
      expect(args[1]).toBe('h264_mf');
      expect(args).toContain('-hw_encoding');
      expect(args[args.indexOf('-hw_encoding') + 1]).toBe('0');
    }
  });
});

describe('probe helpers', () => {
  it('tbToUs is exact for large values', () => {
    expect(tbToUs(15360n, { num: 1, den: 15360 })).toBe(1_000_000);
    expect(tbToUs(1001n, { num: 1, den: 30000 })).toBe(33367);
    expect(tbToUs(-7680n, { num: 1, den: 15360 })).toBe(-500_000);
    expect(tbToUs(1_800_000_000_000n, { num: 1, den: 1_000_000_000 })).toBe(1_800_000_000);
  });
  it('rotation: display matrix is preferred and normalized, tags fallback', () => {
    expect(rotationOf({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }], tags: { rotate: '90' } })).toBe(90);
    expect(rotationOf({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: 90 }] })).toBe(270);
    expect(rotationOf({ tags: { rotate: '180' } })).toBe(180);
    expect(rotationOf({ tags: { rotate: '-90' } })).toBe(270);
    expect(rotationOf({})).toBe(0);
  });
  it('color plan', () => {
    expect(colorPlanFor({ range: null, space: null, transfer: null, primaries: null, pixFmt: 'yuv420p', assumedBt709: true })).toEqual({ inMatrix: null, inRange: null });
    expect(colorPlanFor({ range: 'pc', space: 'smpte170m', transfer: 'bt709', primaries: 'bt709', pixFmt: 'yuvj420p', assumedBt709: false })).toEqual({ inMatrix: 'smpte170m', inRange: 'pc' });
  });
  it('maskPaths hides user names and absolute paths', () => {
    expect(maskPaths('open C:\\Users\\taro\\Videos\\a.mp4 failed')).toBe('open <path> failed');
    expect(maskPaths('/home/taro/x.mp4: error')).toBe('<path>: error');
    expect(maskPaths('\\\\server\\share\\a.mp4')).toBe('<unc-path>');
  });
});
