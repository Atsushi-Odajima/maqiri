// アセット登録: レンダラーへ絶対パスを渡さず、main が管理する assetId で実体を解決する。
// シンボリックリンクは実体を解決し、選択時と処理時で実体が変わっていたら再承認を要求する。
import { randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { AppError } from '@shared/errors';

export interface AssetRecord {
  assetId: string;
  /** ユーザーが選択したパス */
  chosenPath: string;
  /** 実体(realpath) */
  realPath: string;
  dev: number;
  ino: number;
  sizeBytes: number;
  mtimeMs: number;
  registeredAt: number;
  /** 同梱サンプルか */
  isSample: boolean;
}

const assets = new Map<string, AssetRecord>();
const tokens = new Map<string, { kind: string; value: string; createdAt: number; meta?: Record<string, unknown> }>();

export function newId(): string {
  return randomBytes(16).toString('hex');
}

export async function registerAsset(chosenPath: string, isSample = false): Promise<AssetRecord> {
  const real = await realpath(chosenPath);
  const st = await stat(real);
  if (!st.isFile()) throw new AppError('E_FORMAT', '通常のファイルではありません。', { nextAction: '動画ファイルを選んでください。' });
  const rec: AssetRecord = { assetId: newId(), chosenPath, realPath: real, dev: st.dev, ino: st.ino, sizeBytes: st.size, mtimeMs: st.mtimeMs, registeredAt: Date.now(), isSample };
  assets.set(rec.assetId, rec);
  return rec;
}

export function getAsset(assetId: string): AssetRecord {
  const rec = assets.get(assetId);
  if (!rec) throw new AppError('E_IPC', '選択した動画の情報が見つかりません。', { nextAction: '動画を選び直してください。' });
  return rec;
}

/** 処理直前に実体が選択時と同じか確認する。すり替わっていれば再承認を要求。 */
export async function assertAssetUnchanged(rec: AssetRecord): Promise<void> {
  let real: string;
  let st;
  try {
    real = await realpath(rec.chosenPath);
    st = await stat(real);
  } catch {
    throw new AppError('E_READ', '元の動画を読み込めません。移動または削除された可能性があります。', { nextAction: '動画を選び直してください。' });
  }
  if (real !== rec.realPath || st.dev !== rec.dev || st.ino !== rec.ino) {
    throw new AppError('E_READ', '選択時と別のファイルを指しています(リンク先が変わりました)。', { nextAction: '安全のため、動画を選び直してください。' });
  }
  if (st.size !== rec.sizeBytes || Math.round(st.mtimeMs) !== Math.round(rec.mtimeMs)) {
    throw new AppError('E_READ', '元の動画が選択後に変更されました。', { nextAction: '動画を選び直してください。' });
  }
}

/** 一時トークン(保存先・出力結果・回復候補)。レンダラーにはトークンだけ渡す。 */
export function issueToken(kind: string, value: string, meta?: Record<string, unknown>): string {
  const tok = newId();
  tokens.set(tok, { kind, value, createdAt: Date.now(), ...(meta ? { meta } : {}) });
  return tok;
}

export function resolveToken(kind: string, token: string): { value: string; meta?: Record<string, unknown> } {
  const rec = tokens.get(token);
  if (!rec || rec.kind !== kind) throw new AppError('E_IPC', '操作の有効期限が切れました。', { nextAction: 'もう一度やり直してください。' });
  const out: { value: string; meta?: Record<string, unknown> } = { value: rec.value };
  if (rec.meta) out.meta = rec.meta;
  return out;
}

export function listAssets(): AssetRecord[] {
  return [...assets.values()];
}
