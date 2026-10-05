// アプリ全体で使うエラーコード。UI は code + 日本語の原因 + 次操作を表示する。
export type ErrorCode =
  | 'E_FORMAT'
  | 'E_NO_AUDIO'
  | 'E_TOO_LONG'
  | 'E_TOO_LARGE'
  | 'E_TOO_BIG_FRAME'
  | 'E_ENCODER'
  | 'E_ENCODE'
  | 'E_SYNC'
  | 'E_SPACE'
  | 'E_NETWORK_DRIVE'
  | 'E_SAME_PATH'
  | 'E_READ'
  | 'E_WRITE'
  | 'E_CANCELLED'
  | 'E_TOO_MANY_CANDIDATES'
  | 'E_HASH_MISMATCH'
  | 'E_PROJECT_SCHEMA'
  | 'E_IPC'
  | 'E_TOOLS'
  | 'E_DEMO_LIMIT'
  | 'E_INTERNAL';

export interface AppErrorShape {
  code: ErrorCode;
  /** 日本語の原因 */
  message: string;
  /** 次にすべき操作 */
  nextAction?: string | undefined;
  /** 折りたたみ表示する技術詳細(パス等はマスク済み) */
  detail?: string | undefined;
}

export class AppError extends Error implements AppErrorShape {
  readonly code: ErrorCode;
  readonly nextAction: string | undefined;
  readonly detail: string | undefined;
  constructor(code: ErrorCode, message: string, options: { nextAction?: string; detail?: string } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.nextAction = options.nextAction;
    this.detail = options.detail;
  }
  toJSON(): AppErrorShape {
    const out: AppErrorShape = { code: this.code, message: this.message };
    if (this.nextAction !== undefined) out.nextAction = this.nextAction;
    if (this.detail !== undefined) out.detail = this.detail;
    return out;
  }
}

export function isAppErrorShape(x: unknown): x is AppErrorShape {
  return typeof x === 'object' && x !== null && typeof (x as { code?: unknown }).code === 'string' && typeof (x as { message?: unknown }).message === 'string';
}

export function toAppError(e: unknown, fallbackCode: ErrorCode = 'E_INTERNAL'): AppError {
  if (e instanceof AppError) return e;
  if (isAppErrorShape(e)) {
    const opts: { nextAction?: string; detail?: string } = {};
    if (e.nextAction !== undefined) opts.nextAction = e.nextAction;
    if (e.detail !== undefined) opts.detail = e.detail;
    return new AppError(e.code, e.message, opts);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new AppError(fallbackCode, '処理中に予期しないエラーが発生しました。', { detail: msg });
}
