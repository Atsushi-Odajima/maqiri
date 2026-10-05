// 起動時のエンコーダー自己診断: 2 秒の lavfi 素材を実際の設定で h264_mf(または dev エンコーダー)へ書き出す。
// 失敗した場合は E_ENCODER を UI に出し、別コーデックへ黙って変えない。
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { EncoderStatus } from '@shared/types';
import { audioEncoderArgs, encoderPlanFor, outputCommonArgs, type EncoderVariant } from './encoder';
import { runTool, maskPaths } from './process';
import type { MediaTools } from './tools';

export interface SelfTestResult {
  status: EncoderStatus;
  variant: EncoderVariant | null;
}

export async function probeFfmpegVersion(tools: MediaTools): Promise<string> {
  const r = await runTool(tools.ffmpeg, { args: ['-version'], timeoutMs: 30_000 });
  const first = r.stdoutText.split('\n')[0] ?? '';
  const m = /ffmpeg version (\S+)/.exec(first);
  return m?.[1] ?? first.trim();
}

export async function runEncoderSelfTest(tools: MediaTools, tmpDir: string): Promise<SelfTestResult> {
  const plan = encoderPlanFor(tools.kind);
  const ffmpegVersion = await probeFfmpegVersion(tools).catch(() => 'unknown');
  const details: string[] = [];
  for (const variant of plan.variants) {
    const out = path.join(tmpDir, `selftest-${variant.name}.mp4`);
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostats',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=30:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=2',
      '-map',
      '0:v',
      '-map',
      '1:a',
      ...variant.args(6000, 8000),
      '-pix_fmt',
      'yuv420p',
      ...audioEncoderArgs(2, 192),
      ...outputCommonArgs(),
      out
    ];
    try {
      const r = await runTool(tools.ffmpeg, { args, timeoutMs: 60_000 });
      await rm(out, { force: true }).catch(() => undefined);
      if (r.code === 0) {
        return {
          variant,
          status: {
            ok: true,
            encoderName: plan.encoderName,
            variant: variant.name,
            message: `${plan.encoderName} で 2 秒のテスト書き出しに成功しました(${variant.label})。`,
            checkedAt: new Date().toISOString(),
            toolsKind: tools.kind,
            ffmpegVersion
          }
        };
      }
      details.push(`[${variant.name}] exit ${r.code}: ${maskPaths(r.stderrTail).slice(-600)}`);
    } catch (e) {
      details.push(`[${variant.name}] ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return {
    variant: null,
    status: {
      ok: false,
      encoderName: plan.encoderName,
      variant: 'none',
      message: `H.264 エンコーダー(${plan.encoderName})を使えませんでした。この PC では動画を書き出せません。`,
      detail: details.join('\n'),
      checkedAt: new Date().toISOString(),
      toolsKind: tools.kind,
      ffmpegVersion
    }
  };
}
