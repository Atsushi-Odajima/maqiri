// つなぎ目の試聴: 元版 / 編集版を切り替えて聞く。revision が変わると stale になり再生成を促す。
import { useEffect, useRef, useState } from 'react';
import type { JunctionState } from '../state/store';
import { ErrorCallout, Icon, ProgressBlock } from './common';
import { formatFrameTimecode } from '@domain/time';

export function JunctionPanel({ state, onGenerate, canGenerate, disabledReason }: { state: JunctionState; onGenerate: () => void; canGenerate: boolean; disabledReason?: string | null }) {
  const [mode, setMode] = useState<'edited' | 'original'>('edited');
  const edited = useRef<HTMLVideoElement>(null);
  const original = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (state.status === 'ready') {
      setMode('edited');
      const v = edited.current;
      if (v) {
        v.currentTime = 0;
        void v.play().catch(() => undefined);
      }
    }
  }, [state.status, state.preview?.editedMediaUrl]);

  const switchMode = (m: 'edited' | 'original') => {
    const from = m === 'edited' ? original.current : edited.current;
    const to = m === 'edited' ? edited.current : original.current;
    setMode(m);
    if (from && to) {
      // 編集版と元版は同じコンテキスト開始なので、元版の時刻へ写像するのは近似。単純に先頭から再生し直す。
      from.pause();
      to.currentTime = 0;
      void to.play().catch(() => undefined);
    }
  };

  return (
    <section className="junction surface panel" aria-labelledby="junction-h">
      <div className="row between wrap">
        <h2 className="heading-sm" id="junction-h">
          つなぎ目を確認
        </h2>
        <button type="button" className="btn dark" onClick={onGenerate} disabled={!canGenerate} aria-describedby={disabledReason ? 'junction-why' : undefined}>
          <Icon name="compare" />
          {state.status === 'stale' ? 'つなぎ目を作り直す' : 'つなぎ目を確認'}
        </button>
      </div>
      {disabledReason && (
        <p className="note" id="junction-why">
          {disabledReason}
        </p>
      )}
      {state.status === 'idle' && <p className="note mt-3">選んだカットの前後 2 秒を、書き出しと同じ方法で短く作成して聞けます。</p>}
      {state.status === 'loading' && (
        <div className="mt-3">
          <ProgressBlock stage="つなぎ目の試聴用動画を作成中" ratio={null} />
        </div>
      )}
      {state.status === 'stale' && <p className="callout warning mt-3">設定または保持が変わったため、この試聴は古くなりました。作り直してください。</p>}
      {state.status === 'error' && state.error && (
        <div className="mt-3">
          <ErrorCallout error={state.error} onRetry={onGenerate} />
        </div>
      )}
      {state.status === 'ready' && state.preview && (
        <div className="mt-3 stack">
          <div className="row" role="group" aria-label="元版と編集版の切り替え">
            <button type="button" className={`btn small${mode === 'edited' ? ' selected' : ''}`} aria-pressed={mode === 'edited'} onClick={() => switchMode('edited')}>
              編集後
            </button>
            <button type="button" className={`btn small${mode === 'original' ? ' selected' : ''}`} aria-pressed={mode === 'original'} onClick={() => switchMode('original')}>
              元の動画
            </button>
            <span className="note">
              {formatFrameTimecode(state.preview.contextStartFrame)} 〜 {formatFrameTimecode(state.preview.contextEndFrame)}(カット {formatFrameTimecode(state.preview.cut.startFrame)}–{formatFrameTimecode(state.preview.cut.endFrame)})
            </span>
          </div>
          <div className="junction-videos">
            <video ref={edited} src={state.preview.editedMediaUrl} controls preload="auto" style={{ display: mode === 'edited' ? 'block' : 'none' }} aria-label="編集後のつなぎ目" />
            <video ref={original} src={state.preview.originalMediaUrl} controls preload="auto" style={{ display: mode === 'original' ? 'block' : 'none' }} aria-label="元の動画の同じ区間" />
          </div>
        </div>
      )}
    </section>
  );
}
