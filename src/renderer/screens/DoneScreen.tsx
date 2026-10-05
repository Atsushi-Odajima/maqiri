import { useStore } from '../state/store';
import { Icon, formatBytes } from '../components/common';
import { formatFrameClock } from '@domain/time';

export function DoneScreen() {
  const { exportState, openResult, backToEdit, resetToStart, selected } = useStore();
  const r = exportState.report;
  if (!r) return null;
  return (
    <div className="container done">
      <h1 className="heading-ja">書き出しが完了しました</h1>
      <div className="surface panel mt-6 stack loose">
        <div>
          <div className="label-mono">作成したファイル</div>
          <div className="heading-sm">{r.outputBasename}</div>
        </div>
        <dl className="info-grid">
          <dt>長さ</dt>
          <dd>
            {formatFrameClock(r.outputFrames)}({r.outputFrames} フレーム)
            {selected ? ` ← 元 ${formatFrameClock(selected.limitFrames)}` : ''}
          </dd>
          <dt>容量</dt>
          <dd>{formatBytes(r.outputSizeBytes)}</dd>
          <dt>形式</dt>
          <dd>
            {r.videoCodec.toUpperCase()} {r.width}×{r.height} 30fps / {r.audioCodec.toUpperCase()} {r.audioBitrateKbps}kbps
          </dd>
          <dt>処理時間</dt>
          <dd>{(r.elapsedMs / 1000).toFixed(1)} 秒</dd>
        </dl>
        <details className="detail">
          <summary>検証結果とエンコード設定</summary>
          <pre>{`フレーム数: ${r.verification.videoFrameCount.actual} / 期待 ${r.verification.videoFrameCount.expected}
音声長の差: ${r.verification.audioDurationMs.diffMs.toFixed(1)} ms(許容 ±48ms)
映像/音声 終端差: ${r.verification.avEndDiffMs.diffMs.toFixed(1)} ms(許容 ±50ms)
エンコーダー: ${r.encoderName}
設定: ${r.encoderSettings}
映像ビットレート: ${r.videoBitrateKbps} kbps`}</pre>
        </details>
        <div className="row wrap">
          <button type="button" className="btn primary" onClick={() => void openResult('play')} autoFocus>
            <Icon name="play" />
            動画を再生
          </button>
          <button type="button" className="btn" onClick={() => void openResult('reveal')}>
            保存先を開く
          </button>
          <button type="button" className="btn ghost" onClick={backToEdit}>
            もう一度編集
          </button>
          <button type="button" className="btn ghost" onClick={resetToStart}>
            別の動画を選ぶ
          </button>
        </div>
        <p className="note">元の動画は変更していません。削除・投稿・送信は自動では行いません。</p>
      </div>
    </div>
  );
}
