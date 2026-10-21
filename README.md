# Maqiri — 動画の長い無音区間を整える

一人で話す動画から長い無音区間を検出し、残す間を調整してMP4へ書き出す、ローカル処理のデスクトップアプリです。

> **実装ブランチ：`claude/maqiri-r01-implementation`**。この既定ブランチのREADMEは製品の案内です。以下のソース・資料リンクと起動手順は、実装ブランチを参照します。

## できること

- 音量（RMS）による無音候補の検出、保持区間の調整とUndo
- つなぎ目の試聴、音声・映像の時刻を揃えた書き出し
- 元動画を上書きしないプロジェクト管理、demo / fullのビルド分離

## 現在の範囲・制限

- 対象はBGM追加前の単独話者の録画です。文字起こし・字幕・フィラーの意味理解による削除は行いません。
- demo版は先頭90秒。Windows配布物の署名・実機確認、対応形式の確認はリリース前の別工程です。

## 実装の見どころ

**構成：** Electron / React / TypeScript / Zustand、FFmpeg / ffprobe、electron-vite。

- [src/domain](https://github.com/Atsushi-Odajima/maqiri/tree/claude%2Fmaqiri-r01-implementation/src/domain)
- [src/media](https://github.com/Atsushi-Odajima/maqiri/tree/claude%2Fmaqiri-r01-implementation/src/media)
- [src/main](https://github.com/Atsushi-Odajima/maqiri/tree/claude%2Fmaqiri-r01-implementation/src/main)
- [tests](https://github.com/Atsushi-Odajima/maqiri/tree/claude%2Fmaqiri-r01-implementation/tests)

## ローカルで試す

Node.js 22.12以上。media:prepareは固定版FFmpeg等をダウンロード・検証します。

実装ブランチを取得し、次のディレクトリで作業します。

```sh
git clone --branch claude/maqiri-r01-implementation https://github.com/Atsushi-Odajima/maqiri.git
cd maqiri
npm ci
npm run media:prepare
npm run dev
```

環境設定・初期化の詳細：[セットアップ手順](https://github.com/Atsushi-Odajima/maqiri/blob/claude%2Fmaqiri-r01-implementation/docs/SETUP_WINDOWS.txt)。

## 検証方法

`リポジトリ直下` の `package.json` に定義された主な確認コマンドです。DB・ブラウザ・外部ツールを要するものは、開発手順の事前設定が必要です。

```sh
npm run typecheck
npm run test
npm run test:media
npm run test:e2e
npm run build
```

試験の実施環境・結果・未実施項目は、下記の記録を参照してください。画面エミュレーションと実機確認、モックと外部サービスでの確認を区別しています。

## 資料

- [docs/SETUP_WINDOWS.txt](https://github.com/Atsushi-Odajima/maqiri/blob/claude%2Fmaqiri-r01-implementation/docs/SETUP_WINDOWS.txt)
- [docs/HANDOFF.txt](https://github.com/Atsushi-Odajima/maqiri/blob/claude%2Fmaqiri-r01-implementation/docs/HANDOFF.txt)
- [README.md](https://github.com/Atsushi-Odajima/maqiri/blob/claude%2Fmaqiri-r01-implementation/README.md)
- [docs/TEST_REPORT.txt](https://github.com/Atsushi-Odajima/maqiri/blob/claude%2Fmaqiri-r01-implementation/docs/TEST_REPORT.txt)
- [docs/THIRD_PARTY_NOTICES.txt](https://github.com/Atsushi-Odajima/maqiri/blob/claude%2Fmaqiri-r01-implementation/docs/THIRD_PARTY_NOTICES.txt)

## 制作・利用条件

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。
ソース・同梱ライブラリ・フォント・モデル等の利用条件は、各ライセンスと第三者表記を参照してください。リポジトリの閲覧可能性と、再配布・商用利用の許諾は別です。
