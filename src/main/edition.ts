// APP_EDITION は build 時に define で埋め込む。境界は main 側で強制する。
import { DEMO_MAX_FRAMES } from '@shared/constants';
import type { Edition } from '@shared/types';

declare const __APP_EDITION__: string | undefined;

export function currentEdition(): Edition {
  const fromDefine = typeof __APP_EDITION__ === 'string' ? __APP_EDITION__ : undefined;
  const raw = (fromDefine ?? process.env['APP_EDITION'] ?? 'demo').toLowerCase();
  return raw === 'full' ? 'full' : 'demo';
}

/** DEMO: 入力の先頭 90 秒(元時刻、N<=2700)。FULL: 全体。 */
export function limitFramesFor(edition: Edition, totalFrames: number): number {
  return edition === 'demo' ? Math.min(totalFrames, DEMO_MAX_FRAMES) : totalFrames;
}
