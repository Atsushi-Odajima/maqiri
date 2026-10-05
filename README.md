# Maqiri（マキリ）

長い間を、短く。話し方は、そのまま。

1 人で話す動画（講座・解説・商品紹介）の「話していない長い間」を見つけて詰め、つなぎ目を聞いて確認し、必要な間を残して MP4 に書き出す Windows 11（x64）向けデスクトップアプリです。元の動画は書き換えません。

- 対象: BGM を加える前の単独話者の録画。字幕 / 文字起こし / フィラー削除 / 意味理解はしません。
- 配布: `APP_EDITION=demo`（先頭 90 秒のみ、透かしなし）と `APP_EDITION=full`（30 分 / 4GiB まで）の 2 ビルド。制限は main プロセスで強制します。
- 処理はすべてローカル。動画・音声・解析結果を外部へ送信しません。

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `src/main/` | Electron main: IPC（Zod 検証・sender 確認）、ジョブ管理（同時 1 プロセス、export > preview > analysis）、カスタムメディアプロトコル（Range 上限付き）、プロジェクト IO、キャッシュ LRU、エディション境界、エンコーダー自己診断 |
| `src/preload/` | 許可済み API だけを公開（`invoke` / `onEvent`） |
| `src/renderer/` | React + Zustand。S0 開始 / S1 読み込み / S2 間を整える / S3 書き出し / S4 完了 / S5 設定 |
| `src/domain/` | OS 依存なし: 時刻変換（30fps 整数フレーム正本）、RMS 分類、候補生成、保持の差し引き、Undo、プリセット |
| `src/media/` | ffprobe 検査、PCM→RMS ワーカー、filter_complex_script 生成、書き出し、検証、つなぎ目試聴、自己診断 |
| `src/shared/` | Zod スキーマ、IPC 型、定数、エラーコード |
| `resources/media-tools/` | `npm run media:prepare` が取得・検証する FFmpeg（LGPL v3）と対応ソース |
| `assets/` | ロゴ・アイコン・ブランドボード・書体（OFL 原文同梱）。レンダラーから直接配信 |
| `tests/` | `domain`（純粋関数）、`unit`（filter builder / main ロジック）、`media`（実 ffmpeg 統合）、`e2e`（Electron 実起動） |
| `docs/` | SETUP_WINDOWS / TEST_REPORT / RELEASE_CHECKLIST / HANDOFF / THIRD_PARTY_NOTICES / EULA_DRAFT / START_HERE_JA / FORMAT_LIMITS / CHANGELOG |

## 開発コマンド

```
npm ci
npm run media:prepare   # 固定 FFmpeg ビルドの取得と SHA256 検証、対応ソースの生成
npm run typecheck
npm test                # ドメイン / 単体
npm run test:media      # fixture 生成 + 実 ffmpeg 統合テスト
npm run build           # サンプル生成 + electron-vite build
npm run test:e2e        # Electron 実起動（Playwright）
npm run dev
npm run dist:demo       # Windows 上で実行: NSIS x64 per-user
npm run dist:full
```

詳細な手順と検証記録は `docs/SETUP_WINDOWS.txt`、`docs/TEST_REPORT.txt`、引き継ぎは `docs/HANDOFF.txt` を参照してください。

## 時刻の正本

- 出力は 30fps の整数フレーム `[startFrame, endFrame)`、48kHz、1 フレーム = 1,600 サンプル。
- 元の最初の表示映像 PTS を T0 とし、映像・音声を同じ T0 からの時刻へ正規化（音声の遅延を失わない）。
- 解析（20ms RMS、チャンネル別最大）と書き出しは同じ正規化を使い、同期マーカー fixture で 1 フレーム以内を検証。
- 候補 `[s+padBefore, e−padAfter)` は `a=ceil(start·30)`, `b=floor(end·30)` の内側丸め。例: run [10,12) + 自然に → `[305,355)`。

## ライセンス

アプリ本体は `docs/EULA_DRAFT.txt`（草案）。同梱 OSS と書体は `docs/THIRD_PARTY_NOTICES.txt`。FFmpeg は LGPL v3 構成（GPL / nonfree なし）で、H.264 は Windows Media Foundation（`h264_mf`）を使います。
