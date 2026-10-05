import { useEffect, useRef, type ReactNode } from 'react';
import type { AppErrorShape } from '@shared/errors';
import type { Screen } from '../state/store';

export function Icon({ name, label }: { name: 'import' | 'play' | 'restore' | 'cut' | 'export' | 'compare'; label?: string }) {
  return <img className="icon" src={`./icons/${name}.svg`} alt={label ?? ''} aria-hidden={label ? undefined : true} width={20} height={20} />;
}

const STEPS: Array<{ id: Screen[]; label: string }> = [
  { id: ['load'], label: '01 読み込む' },
  { id: ['edit'], label: '02 間を整える' },
  { id: ['done'], label: '03 書き出す' }
];

export function Header({ screen, edition, onLogo, onSettings }: { screen: Screen; edition: 'demo' | 'full' | null; onLogo: () => void; onSettings: () => void }) {
  return (
    <header className="header">
      <div className="container">
        <button type="button" className="logo" onClick={onLogo} aria-label="Maqiri 開始画面へ" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
          <img src="./logo_mark.svg" alt="" width={32} height={32} />
          <span className="wordmark">Maqiri</span>
          {edition === 'demo' && <span className="edition-tag">demo</span>}
        </button>
        <nav className="header-nav" aria-label="工程">
          {STEPS.map((s, i) => (
            <span key={s.label} className="row" style={{ gap: 12 }}>
              {i > 0 && <span className="sep" aria-hidden="true">/</span>}
              <span className="step" aria-current={s.id.includes(screen) ? 'step' : undefined}>
                {s.label}
              </span>
            </span>
          ))}
          <button type="button" className="btn ghost small" onClick={onSettings} aria-label="設定とプロジェクト">
            設定
          </button>
        </nav>
      </div>
    </header>
  );
}

const CODE_HINT: Record<string, string> = {
  E_FORMAT: '対応形式: MP4/MOV、H.264/HEVC(8bit SDR、プログレッシブ)、AAC/PCM(モノ/ステレオ)、30 分・4GiB・1080p 相当以内。',
  E_SPACE: '保存先を変更してください。',
  E_ENCODE: 'ログを保存して再試行してください。',
  E_ENCODER: 'この PC の H.264 エンコーダー(Media Foundation)が使えません。',
  E_SYNC: '完成物の検証に失敗したため保存していません。元の動画は変更されていません。'
};

export function ErrorCallout({ error, onRetry, retryLabel, children }: { error: AppErrorShape; onRetry?: () => void; retryLabel?: string; children?: ReactNode }) {
  return (
    <div className="callout error" role="alert">
      <div className="title">
        <span aria-hidden="true">⚠</span>
        <span>{error.message}</span>
      </div>
      <div className="code mt-2">{error.code}</div>
      {(error.nextAction || CODE_HINT[error.code]) && <p className="body mt-2">{error.nextAction ?? CODE_HINT[error.code]}</p>}
      {error.detail && (
        <details className="detail mt-2">
          <summary>技術的な詳細</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
      {(onRetry || children) && (
        <div className="row mt-4 wrap">
          {onRetry && (
            <button type="button" className="btn small" onClick={onRetry}>
              {retryLabel ?? 'やり直す'}
            </button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export function ProgressBlock({ stage, ratio, onCancel }: { stage: string; ratio: number | null; onCancel?: () => void }) {
  const pct = ratio === null ? null : Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div className="stack" role="status" aria-live="polite">
      <div className="row between">
        <span className="body">{stage}</span>
        <span className="num" aria-hidden={pct === null}>
          {pct === null ? '' : `${pct}%`}
        </span>
      </div>
      <div className={`progress${pct === null ? ' indeterminate' : ''}`} aria-label={stage} role="progressbar" aria-valuemin={0} aria-valuemax={100} {...(pct === null ? {} : { 'aria-valuenow': pct })}>
        <div style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      {onCancel && (
        <div>
          <button type="button" className="btn small" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      )}
    </div>
  );
}

export function Dialog({ title, children, onClose, labelledBy }: { title: string; children: ReactNode; onClose?: (() => void) | undefined; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
      if (e.key === 'Tab' && ref.current) {
        const nodes = ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])');
        if (nodes.length === 0) return;
        const firstEl = nodes[0]!;
        const lastEl = nodes[nodes.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous.current?.focus();
    };
  }, [onClose]);
  const id = labelledBy ?? 'dialog-title';
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <h2 className="heading-sm" id={id}>
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}
