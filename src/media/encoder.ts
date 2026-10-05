// エンコーダー設定。配布版は Windows Media Foundation h264_mf(CPU ソフトウェアモード既定)。
// 開発ホストではテスト専用に libx264 を使う(配布しない)。別コーデックへ黙って変えない。
import type { ToolsKind } from './tools';

export interface EncoderVariant {
  name: string;
  label: string;
  args: (videoBitrateKbps: number, maxrateKbps: number) => string[];
}

export interface EncoderPlan {
  encoderName: 'h264_mf' | 'libx264';
  variants: EncoderVariant[];
}

export function encoderPlanFor(kind: ToolsKind): EncoderPlan {
  if (kind === 'bundled-win32') {
    return {
      encoderName: 'h264_mf',
      variants: [
        {
          name: 'mf-sw-pcvbr-camera',
          label: 'h264_mf / software / pc_vbr / camera_record',
          args: (kbps, max) => ['-c:v', 'h264_mf', '-hw_encoding', '0', '-rate_control', 'pc_vbr', '-b:v', `${kbps}k`, '-maxrate', `${max}k`, '-bufsize', `${kbps * 2}k`, '-g', '60', '-bf', '0', '-profile:v', 'high', '-scenario', 'camera_record']
        },
        {
          name: 'mf-sw-pcvbr',
          label: 'h264_mf / software / pc_vbr',
          args: (kbps, max) => ['-c:v', 'h264_mf', '-hw_encoding', '0', '-rate_control', 'pc_vbr', '-b:v', `${kbps}k`, '-maxrate', `${max}k`, '-bufsize', `${kbps * 2}k`, '-g', '60', '-bf', '0', '-profile:v', 'high']
        },
        {
          name: 'mf-sw-cbr',
          label: 'h264_mf / software / cbr',
          args: (kbps) => ['-c:v', 'h264_mf', '-hw_encoding', '0', '-rate_control', 'cbr', '-b:v', `${kbps}k`, '-g', '60', '-bf', '0', '-profile:v', 'high']
        },
        {
          name: 'mf-sw-default',
          label: 'h264_mf / software / default rate control',
          args: (kbps) => ['-c:v', 'h264_mf', '-hw_encoding', '0', '-b:v', `${kbps}k`, '-g', '60', '-bf', '0']
        }
      ]
    };
  }
  return {
    encoderName: 'libx264',
    variants: [
      {
        name: 'dev-libx264',
        label: 'libx264 (dev-only, not shipped)',
        args: (kbps, max) => ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${kbps}k`, '-maxrate', `${max}k`, '-bufsize', `${kbps * 2}k`, '-g', '60', '-bf', '0', '-profile:v', 'high']
      }
    ]
  };
}

export function audioEncoderArgs(channels: number, bitrateKbps: number): string[] {
  return ['-c:a', 'aac', '-b:a', `${bitrateKbps}k`, '-ar', '48000', '-ac', String(channels)];
}

/** 出力共通のメタデータ/色タグ/コンテナ指定。 */
export function outputCommonArgs(): string[] {
  return ['-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn', '-fps_mode', 'passthrough', '-video_track_timescale', '30000', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', '-f', 'mp4'];
}
