// S5 設定とプロジェクト: 保存場所、キャッシュ、ライセンス状態、診断ログ、フォント/OSS 表記。
import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { invoke } from '../state/api';
import { formatBytes } from '../components/common';
import type { CacheInfo } from '@shared/ipc';

export function SettingsScreen() {
  const { appInfo, encoderStatus, closeSettingsScreen } = useStore();
  const [cache, setCache] = useState<CacheInfo | null>(null);
  const [logText, setLogText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void invoke('cache:info', {}).then(setCache).catch(() => setCache(null));
  }, []);
  return (
    <div className="container settings">
      <div className="row between">
        <h1 className="heading-ja">設定とプロジェクト</h1>
        <button type="button" className="btn" onClick={closeSettingsScreen} autoFocus>
          戻る
        </button>
      </div>
      <div className="grid-12 mt-6">
        <section className="col-8 stack loose">
          <div className="surface panel stack">
            <h2 className="heading-sm">ライセンス状態</h2>
            <p className="body">
              {appInfo?.edition === 'full' ? '製品版(FULL): 30 分 / 4GiB 以内の動画を全体処理できます。' : 'デモ版(DEMO): 入力の先頭 90 秒だけを解析・書き出しします。透かしはありません。'}
            </p>
            <p className="note">バージョン {appInfo?.version ?? '-'} / 変換エンジン {appInfo?.ffmpegVersion ?? '-'}</p>
            <p className="note">
              エンコーダー: {encoderStatus ? (encoderStatus.ok ? `利用可能(${encoderStatus.variant})` : `利用不可 — ${encoderStatus.message}`) : '確認中'}
            </p>
          </div>
          <div className="surface panel stack">
            <h2 className="heading-sm">キャッシュ</h2>
            <p className="body">つなぎ目の試聴用動画などの一時ファイルです。元の動画やプロジェクトは削除しません。</p>
            <p className="note">{cache ? `使用中 ${formatBytes(cache.totalBytes)} / 上限 ${formatBytes(cache.limitBytes)}` : '計算中…'}</p>
            <div>
              <button
                type="button"
                className="btn small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setCache(await invoke('cache:clear', {}));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                キャッシュを消去
              </button>
            </div>
          </div>
          <div className="surface panel stack">
            <h2 className="heading-sm">プロジェクトの保存場所</h2>
            <p className="body">プロジェクト(.maqiri.json)はアプリのデータフォルダーに自動保存されます(変更後 1 秒)。「別名で保存」で任意の場所へコピーできます。</p>
            <p className="note">プロジェクトには動画そのものは含まれません。元の動画の絶対パスと SHA-256 を記録し、移動した場合は選び直して一致を確認します。</p>
          </div>
          <div className="surface panel stack">
            <h2 className="heading-sm">診断ログ</h2>
            <p className="note">ユーザー名や絶対パスはマスクされ、音声やフレームは含まれません。自動送信はしません。</p>
            <div>
              <button type="button" className="btn small" onClick={async () => setLogText((await invoke('diagnostics:read', {})).text || '(ログはありません)')}>
                ログを表示
              </button>
            </div>
            {logText !== null && (
              <details className="detail" open>
                <summary>ログ(末尾)</summary>
                <pre>{logText}</pre>
              </details>
            )}
          </div>
        </section>
        <aside className="col-4 stack loose">
          <div className="surface panel stack">
            <h2 className="heading-sm">プライバシー</h2>
            <p className="note">解析・変換はこの PC の中だけで行います。動画・音声・解析結果を外部へ送信しません。アクセス解析や広告 SDK は含まれていません。</p>
          </div>
          <div className="surface panel stack">
            <h2 className="heading-sm">オープンソースと書体</h2>
            <p className="note">FFmpeg(LGPL v3 構成、Windows Media Foundation の H.264 エンコーダーを使用)、Electron、React、Zustand、Zod。書体: Noto Sans JP / Noto Serif JP / Newsreader / DM Mono(SIL Open Font License)。詳細は同梱の THIRD_PARTY_NOTICES.txt を参照してください。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
