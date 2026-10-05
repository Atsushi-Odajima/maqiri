import { useStore } from '../state/store';
import { ErrorCallout, ProgressBlock } from '../components/common';
import { formatBytes } from '../components/common';

export function LoadScreen() {
  const { picked, probe, sha256, loadProgress, analysisProgress, loadError, needsAudioChoice, chooseAudio, cancelLoad, resetToStart, pickSource, relinkProject, projectId } = useStore();
  const info = probe?.info;
  return (
    <div className="container load">
      <h1 className="heading-ja">読み込み / 解析</h1>
      <p className="note">{picked?.basename ?? ''}</p>
      <div className="surface panel mt-6 stack loose">
        {info && (
          <dl className="info-grid">
            <dt>映像</dt>
            <dd>
              {info.codec.toUpperCase()} {info.displayWidth}×{info.displayHeight} {(info.frameRateNum / info.frameRateDen).toFixed(2)}fps{info.isVfr ? '(可変)' : ''}
              {info.rotation ? ` 回転 ${info.rotation}°` : ''}
            </dd>
            <dt>長さ</dt>
            <dd>
              {(info.durationUs / 1e6).toFixed(2)} 秒({info.totalFrames} フレーム @30fps){probe && probe.limitFrames < info.totalFrames ? ` — デモ版は先頭 ${probe.limitFrames / 30} 秒だけを処理` : ''}
            </dd>
            <dt>サイズ</dt>
            <dd>{formatBytes(info.sizeBytes)}</dd>
            <dt>音声</dt>
            <dd>
              {info.audioTracks.length} トラック{info.audioTracks.length > 1 ? '(1 本を選択)' : ''}。採用したトラックだけを出力し、その他は削除されます。
            </dd>
            <dt>指紋</dt>
            <dd className="num" style={{ fontSize: 13, wordBreak: 'break-all' }}>
              {sha256 ?? '計算中…'}
            </dd>
          </dl>
        )}
        {info && info.warnings.length > 0 && (
          <ul className="callout warning" style={{ margin: 0, paddingLeft: 32 }}>
            {info.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {needsAudioChoice && info && (
          <div className="stack">
            <h2 className="heading-sm">音声トラックを選んでください</h2>
            <p className="note">声の入っているトラックを選びます。無音のトラックを選ぶと「ほぼ全無音」になります。</p>
            <div className="stack tight" role="radiogroup" aria-label="音声トラック">
              {info.audioTracks.map((t) => (
                <button key={t.streamIndex} type="button" className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => void chooseAudio(t.streamIndex)}>
                  <span className="num" style={{ fontSize: 14 }}>
                    #{t.streamIndex}
                  </span>
                  <span>
                    {t.title ?? (t.isDefault ? '既定のトラック' : 'トラック')} — {t.codec.toUpperCase()} {t.channels === 1 ? 'モノラル' : t.channels === 2 ? 'ステレオ' : `${t.channels}ch`} {t.sampleRate}Hz{t.language ? ` (${t.language})` : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {loadProgress && !loadError && <ProgressBlock stage={loadProgress.stage} ratio={loadProgress.ratio} onCancel={() => void cancelLoad()} />}
        {analysisProgress && !loadError && <ProgressBlock stage={analysisProgress.stage} ratio={analysisProgress.ratio} onCancel={() => void cancelLoad()} />}
        {loadError && (
          <ErrorCallout error={loadError} onRetry={() => void pickSource()} retryLabel="動画を選び直す">
            {loadError.code === 'E_READ' && projectId && (
              <button type="button" className="btn small" onClick={() => void relinkProject()}>
                元の動画を選び直して再リンク
              </button>
            )}
            <button type="button" className="btn small ghost" onClick={resetToStart}>
              開始画面へ戻る
            </button>
          </ErrorCallout>
        )}
      </div>
    </div>
  );
}
