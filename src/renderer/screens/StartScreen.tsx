import { useStore } from '../state/store';
import { Icon } from '../components/common';

export function StartScreen() {
  const { appInfo, recent, pickSource, useSample, openProject, toolsError } = useStore();
  const demo = appInfo?.edition === 'demo';
  return (
    <div className="container start">
      <div className="grid-12 start-grid">
        <div className="col-7 start-copy">
          <h1 className="display-ja">
            長い間を、短く。
            <br />
            話し方は、そのまま。
          </h1>
          <p className="body mt-6">撮影した説明動画を選ぶと、話していない長い間を見つけて詰めます。カット候補を聞いて確認し、必要な間は戻せます。元の動画は書き換えません。</p>
          <p className="note mt-3">字幕や文字起こし、言い間違いの削除、話の意味の理解はしません。BGM が常に鳴っている動画や大きな環境音では、無音を見つけられないことがあります。</p>
        </div>
        <div className="col-5">
          <div className="surface panel stack loose">
            <button type="button" className="btn primary" onClick={() => void pickSource()} disabled={!!toolsError} autoFocus>
              <Icon name="import" />
              動画を選ぶ
            </button>
            <button type="button" className="btn" onClick={() => void useSample()} disabled={!!toolsError}>
              <Icon name="play" />
              10 秒の同梱サンプルを試す
            </button>
            <button type="button" className="btn ghost" onClick={() => void openProject(null)}>
              保存したプロジェクトを開く…
            </button>
            <div className="note">
              <strong>対応条件</strong>
              <ul className="conditions">
                <li>MP4 / MOV、映像 1 本 + 音声 1 本(複数なら選択)</li>
                <li>H.264 または HEVC、8bit SDR、プログレッシブ、25〜60fps</li>
                <li>AAC / PCM、モノラルまたはステレオ</li>
                <li>30 分・4GiB・1080p 相当以内(縦動画 1080×1920 可)</li>
                <li>出力: H.264/AAC MP4、30fps、最大 1080p</li>
              </ul>
              {demo && <p className="callout warning mt-3">デモ版は入力の先頭 90 秒だけを解析・書き出しします(透かしなし)。製品版では 30 分まで処理できます。</p>}
            </div>
          </div>
        </div>
      </div>
      {recent.length > 0 && (
        <section className="mt-8" aria-labelledby="recent-h">
          <h2 className="label-mono" id="recent-h">
            最近のプロジェクト
          </h2>
          <ul className="recent-list">
            {recent.map((r) => (
              <li key={r.projectId}>
                <button type="button" className="recent-row" onClick={() => void openProject(r.projectId)}>
                  <span className="body">{r.title}</span>
                  <span className="note">{r.sourceBasename}</span>
                  <span className="num" style={{ fontSize: 14 }}>
                    {new Date(r.updatedAt).toLocaleString('ja-JP')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
