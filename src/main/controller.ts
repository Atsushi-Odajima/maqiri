// アプリの中核(main 側): 素材選択、probe/hash、解析、試聴、書き出し、プロジェクト IO、設定、キャッシュ。
import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { AppError, toAppError } from '@shared/errors';
import { ALGORITHM_VERSION, DEMO_SECONDS, MAX_SOURCE_DURATION_SECONDS, MIN_REMAINING_SECONDS, OUTPUT_FPS, OUTPUT_PRESETS, type OutputPresetId } from '@shared/constants';
import { EVENT_CHANNEL, type AppInfo, type CacheInfo, type LoadedProject, type MainEvent, type PickedSource, type ProbeResult, type RecoveryInfo, type RenderedPreview } from '@shared/ipc';
import type { IpcPayload } from '@shared/schemas';
import type { ProjectFile } from '@shared/schemas';
import type { DestinationInfo, Edition, EncoderStatus, ExportReport, JunctionPreview, RecentProjectEntry, SelectedSource, SourceInfo } from '@shared/types';
import { formatFrameTimecode } from '@domain/time';
import { unionRanges, type FrameRange } from '@domain/ranges';
import { resolveTools, sha256File, verifyBundledTools, type MediaTools } from '@media/tools';
import { probeSource, defaultAudioTrack, validateAudioTrack, colorPlanFor } from '@media/probe';
import { runAnalysis } from '@media/analysis';
import { planExport, runExport } from '@media/export';
import { verifyOutput } from '@media/verify';
import { renderJunction, junctionWindow } from '@media/junction';
import { encoderPlanFor, type EncoderVariant } from '@media/encoder';
import { runEncoderSelfTest, probeFfmpegVersion } from '@media/selftest';
import { assertAssetUnchanged, issueToken, newId, registerAsset, resolveToken, type AssetRecord } from './assets';
import { CacheManager } from './cache';
import { limitFramesFor } from './edition';
import { atomicWriteFile, csvCell, freeBytesAt, isNetworkPath, safeUnlink, sameFile, uniqueOutputPath } from './fsutil';
import { JobManager, type JobContext } from './jobs';
import { log, readLogTail } from './log';
import { createProjectStore, listRecoveryCandidates, loadProjectFile, newProjectId, projectFilePath, readRecent, resolveRecovery, saveProject, touchRecent, type ProjectStore, type RecoveryCandidate } from './projects';
import { assetMediaUrl, registerCacheMedia } from './protocol';
import { SettingsStore } from './settings';

export interface ControllerDeps {
  edition: Edition;
  userDataDir: string;
  resourcesDir: string;
  workerPath: string;
  appVersion: string;
  getWindow: () => BrowserWindow | null;
  isDev: boolean;
}

interface SourceState {
  record: AssetRecord;
  info?: SourceInfo;
  sha256?: string;
  selected?: SelectedSource;
}

const VIDEO_FILTERS = [{ name: '動画 (MP4/MOV)', extensions: ['mp4', 'mov', 'm4v'] }];

export class AppController {
  readonly jobs: JobManager;
  readonly cache: CacheManager;
  readonly store: ProjectStore;
  readonly settings: SettingsStore;
  private tools: MediaTools | null = null;
  private toolsError: AppError | null = null;
  private ffmpegVersion = 'unknown';
  private encoderStatus: EncoderStatus | null = null;
  private encoderVariant: EncoderVariant | null = null;
  private readonly sources = new Map<string, SourceState>();
  private readonly recovery = new Map<string, RecoveryCandidate>();
  private readonly projectPaths = new Map<string, string>();

  constructor(private readonly deps: ControllerDeps) {
    this.jobs = new JobManager((p) => this.emit({ type: 'job:progress', progress: p }));
    this.cache = new CacheManager(path.join(deps.userDataDir, 'cache'));
    this.store = createProjectStore(deps.userDataDir);
    this.settings = new SettingsStore(deps.userDataDir);
  }

  emit(event: MainEvent): void {
    const win = this.deps.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event);
  }

  get edition(): Edition {
    return this.deps.edition;
  }

  // ---------- 起動時 ----------
  async startupChecks(): Promise<void> {
    await this.settings.load();
    this.cache.setLimit(this.settings.get().cacheLimitBytes);
    await mkdir(this.store.projectsDir, { recursive: true });
    try {
      this.tools = resolveTools(path.join(this.deps.resourcesDir, 'media-tools'));
      await verifyBundledTools(this.tools);
      this.ffmpegVersion = await probeFfmpegVersion(this.tools);
      await log('info', `tools ${this.tools.kind} ffmpeg=${this.ffmpegVersion}`);
    } catch (e) {
      this.toolsError = toAppError(e, 'E_TOOLS');
      this.emit({ type: 'app:toolsError', error: this.toolsError.toJSON() });
      return;
    }
    // 回復候補
    const candidates = await listRecoveryCandidates(this.store);
    if (candidates.length) {
      const infos: RecoveryInfo[] = candidates.map((c) => {
        const token = issueToken('recovery', c.tmpPath);
        this.recovery.set(token, c);
        return { recoveryToken: token, title: c.title, modifiedAt: c.modifiedAt };
      });
      this.emit({ type: 'app:recovery', candidates: infos });
    }
    // エンコーダー自己診断(2 秒)。キャンセルされた場合(起動直後の操作と競合)は 1 回だけやり直す。
    const tools = this.tools;
    const runSelfTest = () =>
      this.jobs.submit('selftest', async () => {
        const dir = path.join(this.deps.userDataDir, 'cache', '_selftest');
        await mkdir(dir, { recursive: true });
        return runEncoderSelfTest(tools, dir);
      }).result;
    try {
      let r: Awaited<ReturnType<typeof runEncoderSelfTest>>;
      try {
        r = await runSelfTest();
      } catch (e) {
        if (toAppError(e).code !== 'E_CANCELLED') throw e;
        r = await runSelfTest();
      }
      this.encoderStatus = r.status;
      this.encoderVariant = r.variant;
      await log(r.status.ok ? 'info' : 'error', `encoder selftest: ${r.status.message}`, r.status.detail);
      this.emit({ type: 'app:encoderStatus', status: r.status });
    } catch (e) {
      const err = toAppError(e, 'E_ENCODER');
      this.encoderStatus = { ok: false, encoderName: encoderPlanFor(tools.kind).encoderName, variant: 'none', message: err.message, detail: err.detail ?? '', checkedAt: new Date().toISOString(), toolsKind: tools.kind, ffmpegVersion: this.ffmpegVersion };
      this.emit({ type: 'app:encoderStatus', status: this.encoderStatus });
    }
    await this.cache.enforceLimit().catch(() => undefined);
    await this.cleanupStaleExportTemps();
  }

  async shutdown(): Promise<void> {
    this.jobs.cancelAll();
  }

  cancelAllJobs(): void {
    this.jobs.cancelAll();
  }

  private requireTools(): MediaTools {
    if (this.tools) return this.tools;
    throw this.toolsError ?? new AppError('E_TOOLS', '変換ツールの準備ができていません。', { nextAction: 'アプリを再起動してください。' });
  }

  private requireEncoder(): EncoderVariant {
    if (this.encoderVariant) return this.encoderVariant;
    if (this.encoderStatus && !this.encoderStatus.ok) {
      throw new AppError('E_ENCODER', this.encoderStatus.message, { nextAction: 'Windows Update で Media Foundation を含む更新を適用し、再起動後にもう一度お試しください。', detail: this.encoderStatus.detail ?? '' });
    }
    throw new AppError('E_ENCODER', 'エンコーダーの確認がまだ終わっていません。', { nextAction: '数秒待ってからもう一度お試しください。' });
  }

  private state(assetId: string): SourceState {
    const s = this.sources.get(assetId);
    if (!s) throw new AppError('E_IPC', '選択した動画の情報が見つかりません。', { nextAction: '動画を選び直してください。' });
    return s;
  }

  private selected(assetId: string): SelectedSource {
    const s = this.state(assetId);
    if (!s.selected) throw new AppError('E_IPC', '音声トラックが選択されていません。', { nextAction: '読み込みをやり直してください。' });
    return s.selected;
  }

  // ---------- 素材 ----------
  async pickSource(): Promise<PickedSource | null> {
    const win = this.deps.getWindow();
    const r = await dialog.showOpenDialog(win ?? undefined!, { title: '動画を選ぶ', properties: ['openFile'], filters: VIDEO_FILTERS });
    if (r.canceled || !r.filePaths[0]) return null;
    const chosen = r.filePaths[0];
    if (/^[a-z]+:\/\//i.test(chosen)) throw new AppError('E_FORMAT', 'URL は入力できません。', { nextAction: 'PC 内の動画ファイルを選んでください。' });
    const record = await registerAsset(chosen);
    this.sources.set(record.assetId, { record });
    await log('info', 'source picked', { basename: path.basename(chosen), size: record.sizeBytes });
    return { assetId: record.assetId, basename: path.basename(chosen), isSample: false };
  }

  async useSample(): Promise<PickedSource> {
    const sample = path.join(this.deps.resourcesDir, 'sample', 'sample_10s.mp4');
    if (!existsSync(sample)) throw new AppError('E_READ', '同梱サンプルが見つかりません。', { nextAction: '動画を選んでください。' });
    const record = await registerAsset(sample, true);
    this.sources.set(record.assetId, { record });
    return { assetId: record.assetId, basename: 'sample_10s.mp4', isSample: true };
  }

  startProbe(assetId: string): { jobId: string } {
    const tools = this.requireTools();
    const st = this.state(assetId);
    const { jobId, result } = this.jobs.submit('probe', async (ctx) => {
      await assertAssetUnchanged(st.record);
      const info = await probeSource(tools, st.record.realPath, { signal: ctx.signal, onProgress: (p) => ctx.progress(p.stage, p.ratio) });
      st.info = info;
      const def = defaultAudioTrack(info.audioTracks);
      const out: ProbeResult = { info, proposedAudioStreamIndex: def?.streamIndex ?? info.audioTracks[0]!.streamIndex, limitFrames: limitFramesFor(this.deps.edition, info.totalFrames), edition: this.deps.edition };
      return out;
    });
    this.settle(jobId, 'probe', result);
    return { jobId };
  }

  startHash(assetId: string): { jobId: string } {
    const st = this.state(assetId);
    const { jobId, result } = this.jobs.submit('hash', async (ctx) => {
      const total = st.record.sizeBytes;
      const sha256 = await sha256File(st.record.realPath, (done) => ctx.progress('元の動画の指紋(SHA-256)を計算中', total ? done / total : null));
      st.sha256 = sha256;
      return { sha256 };
    });
    this.settle(jobId, 'hash', result);
    return { jobId };
  }

  async selectAudio(assetId: string, audioStreamIndex: number): Promise<SelectedSource & { mediaUrl: string }> {
    const st = this.state(assetId);
    if (!st.info) throw new AppError('E_IPC', '動画の確認が終わっていません。');
    if (!st.sha256) throw new AppError('E_IPC', '指紋の計算が終わっていません。');
    const track = st.info.audioTracks.find((t) => t.streamIndex === audioStreamIndex);
    if (!track) throw new AppError('E_IPC', '指定の音声トラックがありません。');
    validateAudioTrack(track);
    const selected: SelectedSource = {
      ...st.info,
      assetId,
      sha256: st.sha256,
      audioStreamIndex,
      channels: track.channels,
      sampleRate: track.sampleRate,
      audioCodec: track.codec,
      limitFrames: limitFramesFor(this.deps.edition, st.info.totalFrames)
    };
    st.selected = selected;
    return { ...selected, mediaUrl: assetMediaUrl(assetId) };
  }

  // ---------- 解析 ----------
  startAnalysis(assetId: string): { jobId: string } {
    const tools = this.requireTools();
    const st = this.state(assetId);
    const sel = this.selected(assetId);
    const { jobId, result } = this.jobs.submit('analysis', async (ctx) => {
      await assertAssetUnchanged(st.record);
      ctx.progress('音量を解析中', 0);
      return runAnalysis({
        workerPath: this.deps.workerPath,
        signal: ctx.signal,
        data: { ffmpeg: tools.ffmpeg, file: st.record.realPath, audioStreamIndex: sel.audioStreamIndex, channels: sel.channels, t0Us: sel.firstVideoPtsUs, limitFrames: sel.limitFrames },
        onProgress: (ratio) => ctx.progress('音量を解析中', ratio)
      });
    });
    this.settle(jobId, 'analysis', result);
    return { jobId };
  }

  // ---------- つなぎ目試聴 ----------
  startJunction(p: IpcPayload<'junction:generate'>): { jobId: string } {
    const tools = this.requireTools();
    const variant = this.requireEncoder();
    const st = this.state(p.assetId);
    const sel = this.selected(p.assetId);
    this.validateCutsForSource(sel, [p.cut]);
    const { jobId, result } = this.jobs.submit(
      'preview',
      async (ctx) => {
        await assertAssetUnchanged(st.record);
        const dir = await this.cache.dirFor(p.assetId, p.revision);
        const safeId = p.candidateId.replace(/[^A-Za-z0-9_-]/g, '_');
        const orig = path.join(dir, `junction-${safeId}-orig.mp4`);
        const edit = path.join(dir, `junction-${safeId}-edit.mp4`);
        const plan = { inputFile: st.record.realPath, videoStreamIndex: sel.videoStreamIndex, audioStreamIndex: sel.audioStreamIndex, t0Us: sel.firstVideoPtsUs, totalFrames: sel.limitFrames, cut: p.cut, displayWidth: sel.displayWidth, displayHeight: sel.displayHeight, channels: sel.channels, color: colorPlanFor(sel.colorInfo) };
        const win = junctionWindow(p.cut, sel.limitFrames);
        if (!existsSync(orig)) {
          ctx.progress('元の前後を作成中', 0.1);
          const tmp = `${orig}.tmp.mp4`;
          await renderJunction(tools, plan, false, variant, path.join(dir, `junction-${safeId}-orig.txt`), tmp, ctx.signal);
          await rename(tmp, orig);
        }
        if (!existsSync(edit)) {
          ctx.progress('編集後の前後を作成中', 0.6);
          const tmp = `${edit}.tmp.mp4`;
          await renderJunction(tools, plan, true, variant, path.join(dir, `junction-${safeId}-edit.txt`), tmp, ctx.signal);
          await rename(tmp, edit);
        }
        this.cache.markInUse(orig);
        this.cache.markInUse(edit);
        const out: JunctionPreview = {
          candidateId: p.candidateId,
          revision: p.revision,
          contextStartFrame: win.startFrame,
          contextEndFrame: win.endFrame,
          cut: p.cut,
          originalMediaUrl: registerCacheMedia(newId(), orig),
          editedMediaUrl: registerCacheMedia(newId(), edit)
        };
        void this.cache.enforceLimit();
        return out;
      },
      { replaceKey: 'junction' }
    );
    this.settle(jobId, 'preview', result);
    return { jobId };
  }

  /**
   * 元プレビュー用 720p proxy(HEVC 等、ブラウザで再生できない素材向け)と、低ビットレートの全体確定プレビュー。
   * どちらも書き出しと同じ正規化(T0, 30fps, N へのクランプ)を使うので、再生時刻 = 正規化後の時刻になる。
   */
  startPreviewRender(p: IpcPayload<'preview:render'>): { jobId: string } {
    const tools = this.requireTools();
    const variant = this.requireEncoder();
    const st = this.state(p.assetId);
    const sel = this.selected(p.assetId);
    const cuts = p.kind === 'full' ? this.validateCutsForSource(sel, p.cutRanges) : [];
    const { jobId, result } = this.jobs.submit(
      'preview',
      async (ctx) => {
        await assertAssetUnchanged(st.record);
        const dir = await this.cache.dirFor(p.assetId, p.kind === 'proxy' ? 0 : p.revision);
        const out = path.join(dir, p.kind === 'proxy' ? 'proxy-720p.mp4' : `full-preview-r${p.revision}.mp4`);
        const scriptPath = path.join(dir, `${p.kind}-filters.txt`);
        const inv = planExport(
          { inputFile: st.record.realPath, videoStreamIndex: sel.videoStreamIndex, audioStreamIndex: sel.audioStreamIndex, t0Us: sel.firstVideoPtsUs, totalFrames: sel.limitFrames, cuts, displayWidth: sel.displayWidth, displayHeight: sel.displayHeight, channels: sel.channels, color: colorPlanFor(sel.colorInfo), outputPreset: '720p30', bitrateScale: 0.35 },
          variant,
          scriptPath,
          `${out}.tmp.mp4`
        );
        if (!existsSync(out)) {
          ctx.progress(p.kind === 'proxy' ? 'プレビュー用の動画を作成中' : '全体の確定プレビューを作成中', 0);
          await runExport(tools, inv, scriptPath, { signal: ctx.signal, onProgress: (ratio) => ctx.progress(p.kind === 'proxy' ? 'プレビュー用の動画を作成中' : '全体の確定プレビューを作成中', ratio) });
          await rename(`${out}.tmp.mp4`, out);
        }
        this.cache.markInUse(out);
        void this.cache.enforceLimit();
        const r: RenderedPreview = { kind: p.kind, revision: p.revision, mediaUrl: registerCacheMedia(newId(), out), frames: inv.expectedFrames };
        return r;
      },
      p.kind === 'full' ? { replaceKey: 'full-preview' } : {}
    );
    this.settle(jobId, 'preview', result);
    return { jobId };
  }

  /** 前回のクラッシュで残った書き出し途中の一時ファイル(.*.maqiri-tmp-*.mp4、1 時間以上前)を最後の保存先から掃除する。 */
  private async cleanupStaleExportTemps(): Promise<void> {
    const dir = this.settings.get().lastExportDir;
    if (!dir || !existsSync(dir)) return;
    try {
      for (const name of await readdir(dir)) {
        if (!/^\..*\.maqiri-tmp-[0-9a-f]{8}\.mp4$/.test(name)) continue;
        const full = path.join(dir, name);
        const st = await stat(full);
        if (Date.now() - st.mtimeMs > 60 * 60_000) {
          await safeUnlink(full);
          await log('info', 'removed stale export temp', { name });
        }
      }
    } catch {
      /* ignore */
    }
  }

  // ---------- 書き出し ----------
  private validateCutsForSource(sel: SelectedSource, cuts: FrameRange[]): FrameRange[] {
    for (const c of cuts) {
      if (c.endFrame > sel.limitFrames) {
        throw new AppError(this.deps.edition === 'demo' ? 'E_DEMO_LIMIT' : 'E_IPC', this.deps.edition === 'demo' ? `デモ版では先頭 ${DEMO_SECONDS} 秒だけを処理できます。` : 'カット範囲が動画の長さを超えています。', { nextAction: this.deps.edition === 'demo' ? '製品版では動画全体(30 分まで)を処理できます。' : '解析をやり直してください。' });
      }
    }
    return unionRanges(cuts);
  }

  async pickDestination(p: IpcPayload<'export:pickDestination'>): Promise<DestinationInfo | null> {
    const st = this.state(p.assetId);
    const sel = this.selected(p.assetId);
    const win = this.deps.getWindow();
    const defaultDir = this.settings.get().lastExportDir ?? path.dirname(st.record.chosenPath);
    const suggested = await uniqueOutputPath(defaultDir, sanitizeBasename(p.suggestedBasename));
    // E2E テスト用フック(非パッケージ版のみ): ネイティブダイアログを出さずに保存先を固定する
    const e2eDir = !app.isPackaged ? process.env['MAQIRI_E2E_EXPORT_DIR'] : undefined;
    let dest: string;
    if (e2eDir) {
      dest = path.join(e2eDir, sanitizeBasename(p.suggestedBasename));
    } else {
      const r = await dialog.showSaveDialog(win ?? undefined!, { title: '保存先を選ぶ', defaultPath: suggested, filters: [{ name: 'MP4 動画', extensions: ['mp4'] }], properties: ['showOverwriteConfirmation'] });
      if (r.canceled || !r.filePath) return null;
      dest = r.filePath;
    }
    if (!dest.toLowerCase().endsWith('.mp4')) dest += '.mp4';
    const dir = path.dirname(dest);
    if (await isNetworkPath(dir)) {
      throw new AppError('E_NETWORK_DRIVE', 'ネットワークドライブへの保存にはまだ対応していません。', { nextAction: 'PC 内のフォルダー(ドキュメントや動画など)を選んでください。' });
    }
    if (await sameFile(dest, st.record.realPath)) {
      throw new AppError('E_SAME_PATH', '元の動画と同じファイルには保存できません。', { nextAction: '別のファイル名を選んでください。元の動画は変更しません。' });
    }
    const preset = OUTPUT_PRESETS[p.outputPreset];
    const seconds = p.outputFrames / OUTPUT_FPS;
    const cacheBytes = await this.cache.totalBytes().catch(() => 0);
    const required = Math.ceil((((preset.videoBitrateKbps + 192) * 1000 * seconds) / 8) * 1.5) + cacheBytes + 1024 * 1024 * 1024;
    const free = await freeBytesAt(dir).catch(() => Number.MAX_SAFE_INTEGER);
    if (free < required) {
      throw new AppError('E_SPACE', `保存先の空き容量が不足しています(必要 約${(required / 1e9).toFixed(1)}GB、空き 約${(free / 1e9).toFixed(1)}GB)。`, { nextAction: '別のドライブを選ぶか、不要なファイルを削除してください。' });
    }
    const willOverwrite = existsSync(dest);
    await this.settings.update({ lastExportDir: dir });
    const token = issueToken('destination', dest, { assetId: p.assetId, requiredBytes: required });
    void sel;
    return { destinationToken: token, basename: path.basename(dest), folderDisplay: displayFolder(dir), freeBytes: free, requiredBytes: required, willOverwrite };
  }

  startExport(p: IpcPayload<'export:start'>): { jobId: string } {
    const tools = this.requireTools();
    const variant = this.requireEncoder();
    const st = this.state(p.assetId);
    const sel = this.selected(p.assetId);
    const destInfo = resolveToken('destination', p.destinationToken);
    if (destInfo.meta?.['assetId'] !== p.assetId) throw new AppError('E_IPC', '保存先の指定が別の動画のものです。');
    const dest = destInfo.value;
    const cuts = this.validateCutsForSource(sel, p.cutRanges);
    const totalFrames = sel.limitFrames;
    const outputFrames = totalFrames - cuts.reduce((a, c) => a + c.endFrame - c.startFrame, 0);
    if (outputFrames < MIN_REMAINING_SECONDS * OUTPUT_FPS) {
      throw new AppError('E_IPC', '出力が 1 秒未満になるため書き出せません。', { nextAction: '保持する区間を増やしてください。' });
    }
    const { jobId, result } = this.jobs.submit('export', async (ctx) => {
      const started = Date.now();
      await assertAssetUnchanged(st.record);
      if (await sameFile(dest, st.record.realPath)) throw new AppError('E_SAME_PATH', '元の動画と同じファイルには保存できません。');
      if (existsSync(dest) && !p.overwriteConfirmed) throw new AppError('E_WRITE', '同名のファイルがあります。上書きには確認が必要です。', { nextAction: '別名にするか、上書きを確認してください。' });
      const dir = path.dirname(dest);
      const tmp = path.join(dir, `.${path.basename(dest, '.mp4')}.maqiri-tmp-${newId().slice(0, 8)}.mp4`);
      const scriptDir = await this.cache.dirFor(p.assetId, p.revision);
      const scriptPath = path.join(scriptDir, `export-${newId().slice(0, 8)}.txt`);
      const inv = planExport(
        { inputFile: st.record.realPath, videoStreamIndex: sel.videoStreamIndex, audioStreamIndex: sel.audioStreamIndex, t0Us: sel.firstVideoPtsUs, totalFrames, cuts, displayWidth: sel.displayWidth, displayHeight: sel.displayHeight, channels: sel.channels, color: colorPlanFor(sel.colorInfo), outputPreset: p.outputPreset },
        variant,
        scriptPath,
        tmp
      );
      await log('info', 'export start', { preset: p.outputPreset, cuts: cuts.length, expectedFrames: inv.expectedFrames, encoder: inv.encoderSettings });
      try {
        ctx.progress('動画を書き出し中', 0);
        await runExport(tools, inv, scriptPath, { signal: ctx.signal, onProgress: (ratio) => ctx.progress('動画を書き出し中', ratio * 0.9) });
        ctx.progress('完成した動画を検証中', 0.92);
        const ver = await verifyOutput(tools, tmp, inv.expectedFrames, inv.outWidth, inv.outHeight, sel.channels, ctx.signal);
        if (!ver.ok) {
          await safeUnlink(tmp);
          await log('error', 'export verification failed', ver.problems);
          throw new AppError('E_SYNC', '完成した動画の検証に失敗したため、保存しませんでした。', { nextAction: 'もう一度試してください。繰り返す場合は診断ログを保存して報告してください。', detail: ver.problems.join('\n') });
        }
        if (await sameFile(tmp, st.record.realPath)) throw new AppError('E_SAME_PATH', '出力先が元の動画と同じです。');
        await rename(tmp, dest);
        const outStat = await stat(dest);
        const report: ExportReport & { exportToken: string } = {
          outputBasename: path.basename(dest),
          outputSizeBytes: outStat.size,
          outputFrames: inv.expectedFrames,
          outputDurationUs: Math.round((inv.expectedFrames / OUTPUT_FPS) * 1_000_000),
          videoCodec: ver.videoCodec,
          audioCodec: ver.audioCodec,
          width: ver.width,
          height: ver.height,
          encoderName: encoderPlanFor(tools.kind).encoderName,
          encoderSettings: `${inv.encoderLabel} :: ${inv.encoderSettings}`,
          audioBitrateKbps: inv.audioBitrateKbps,
          videoBitrateKbps: inv.videoBitrateKbps,
          verification: { videoFrameCount: ver.videoFrameCount, audioDurationMs: ver.audioDurationMs, avEndDiffMs: ver.avEndDiffMs },
          elapsedMs: Date.now() - started,
          exportedAt: new Date().toISOString(),
          exportToken: issueToken('export', dest)
        };
        await log('info', 'export done', { frames: report.outputFrames, bytes: report.outputSizeBytes, elapsedMs: report.elapsedMs, encoder: report.encoderSettings });
        await safeUnlink(scriptPath);
        return report;
      } catch (e) {
        await safeUnlink(tmp);
        throw e;
      }
    });
    this.settle(jobId, 'export', result);
    return { jobId };
  }

  async openResult(token: string, action: 'play' | 'reveal'): Promise<{ ok: boolean }> {
    const { value } = resolveToken('export', token);
    if (!existsSync(value)) throw new AppError('E_READ', '完成した動画が見つかりません。移動または削除された可能性があります。');
    if (action === 'reveal') {
      shell.showItemInFolder(value);
      return { ok: true };
    }
    const err = await shell.openPath(value);
    return { ok: !err };
  }

  // ---------- プロジェクト ----------
  async saveProject(p: IpcPayload<'project:save'>): Promise<{ projectBasename: string; savedAt: string }> {
    const st = this.state(p.project.assetId);
    const sel = this.selected(p.project.assetId);
    const { assetId: _assetId, ...rest } = p.project;
    const project: ProjectFile = {
      ...rest,
      algorithmVersion: ALGORITHM_VERSION,
      source: {
        basename: sel.basename,
        absolutePath: st.record.chosenPath,
        sha256: sel.sha256,
        sizeBytes: sel.sizeBytes,
        mtimeMs: sel.mtimeMs,
        durationUs: sel.durationUs,
        firstVideoPtsUs: sel.firstVideoPtsUs,
        videoStreamIndex: sel.videoStreamIndex,
        audioStreamIndex: sel.audioStreamIndex,
        displayWidth: sel.displayWidth,
        displayHeight: sel.displayHeight,
        rotation: sel.rotation,
        frameRateNum: sel.frameRateNum,
        frameRateDen: sel.frameRateDen,
        sampleRate: sel.sampleRate,
        channels: sel.channels,
        codec: sel.codec,
        colorInfo: sel.colorInfo
      }
    };
    const file = this.projectPaths.get(project.id) ?? projectFilePath(this.store, project.id);
    await saveProject(file, project);
    this.projectPaths.set(project.id, file);
    await touchRecent(this.store, { projectId: project.id, title: project.title, sourceBasename: sel.basename, updatedAt: project.updatedAt, projectPath: file });
    if (p.saveAs) {
      const win = this.deps.getWindow();
      const r = await dialog.showSaveDialog(win ?? undefined!, { title: 'プロジェクトを別名で保存', defaultPath: path.join(app.getPath('documents'), `${sanitizeBasename(project.title)}.maqiri.json`), filters: [{ name: 'Maqiri プロジェクト', extensions: ['json'] }] });
      if (!r.canceled && r.filePath) {
        await copyFile(file, r.filePath);
        return { projectBasename: path.basename(r.filePath), savedAt: project.updatedAt };
      }
    }
    return { projectBasename: path.basename(file), savedAt: project.updatedAt };
  }

  async listRecent(): Promise<RecentProjectEntry[]> {
    const list = await readRecent(this.store);
    return list.filter((e) => existsSync(e.projectPath)).slice(0, 3).map((e) => ({ projectId: e.projectId, title: e.title, sourceBasename: e.sourceBasename, updatedAt: e.updatedAt, projectBasename: path.basename(e.projectPath) }));
  }

  async openProject(projectId: string | null): Promise<LoadedProject | null> {
    let file: string | null = null;
    if (projectId) {
      const rec = (await readRecent(this.store)).find((e) => e.projectId === projectId);
      file = rec?.projectPath ?? projectFilePath(this.store, projectId);
    } else {
      const win = this.deps.getWindow();
      const r = await dialog.showOpenDialog(win ?? undefined!, { title: 'プロジェクトを開く', properties: ['openFile'], filters: [{ name: 'Maqiri プロジェクト', extensions: ['json'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      file = r.filePaths[0];
    }
    const project = await loadProjectFile(file);
    this.projectPaths.set(project.id, file);
    return this.attachSource(project, file, project.source.absolutePath);
  }

  async relinkProject(projectId: string): Promise<LoadedProject | null> {
    const file = this.projectPaths.get(projectId);
    if (!file) throw new AppError('E_IPC', 'プロジェクトが開かれていません。');
    const project = await loadProjectFile(file);
    const win = this.deps.getWindow();
    const r = await dialog.showOpenDialog(win ?? undefined!, { title: `元の動画を選び直す: ${project.source.basename}`, properties: ['openFile'], filters: VIDEO_FILTERS });
    if (r.canceled || !r.filePaths[0]) return null;
    const loaded = await this.attachSource(project, file, r.filePaths[0]);
    if (loaded.sourceStatus === 'ok') {
      const updated: ProjectFile = { ...project, source: { ...project.source, absolutePath: r.filePaths[0] }, updatedAt: new Date().toISOString() };
      await saveProject(file, updated);
    }
    return loaded;
  }

  /** プロジェクトの元素材を確認(存在、hash 一致)し、一致すれば選択状態を復元する。 */
  private async attachSource(project: ProjectFile, projectFile: string, sourcePath: string): Promise<LoadedProject> {
    const { absolutePath: _abs, ...sourceNoPath } = project.source;
    const base: LoadedProject = { project: { ...project, source: sourceNoPath }, selected: null, sourceStatus: 'missing', projectBasename: path.basename(projectFile) };
    if (!existsSync(sourcePath)) return base;
    const record = await registerAsset(sourcePath);
    this.sources.set(record.assetId, { record });
    const st = this.state(record.assetId);
    const hashJob = this.jobs.submit('hash', async (ctx: JobContext) => sha256File(record.realPath, (done) => ctx.progress('元の動画の指紋(SHA-256)を確認中', record.sizeBytes ? done / record.sizeBytes : null)));
    const sha256 = await hashJob.result;
    if (sha256 !== project.source.sha256) {
      await log('warn', 'project source hash mismatch', { basename: path.basename(sourcePath) });
      return { ...base, sourceStatus: 'hash-mismatch' };
    }
    st.sha256 = sha256;
    const tools = this.requireTools();
    const probeJob = this.jobs.submit('probe', async (ctx: JobContext) => probeSource(tools, record.realPath, { signal: ctx.signal, onProgress: (pr) => ctx.progress(pr.stage, pr.ratio) }));
    const info = await probeJob.result;
    st.info = info;
    const track = info.audioTracks.find((t) => t.streamIndex === project.source.audioStreamIndex) ?? defaultAudioTrack(info.audioTracks);
    if (!track) return { ...base, sourceStatus: 'hash-mismatch' };
    const selected = await this.selectAudio(record.assetId, track.streamIndex);
    await touchRecent(this.store, { projectId: project.id, title: project.title, sourceBasename: project.source.basename, updatedAt: project.updatedAt, projectPath: projectFile });
    return { ...base, selected, sourceStatus: 'ok' };
  }

  async exportCuts(p: IpcPayload<'project:exportCuts'>): Promise<{ basename: string } | null> {
    const win = this.deps.getWindow();
    const ext = p.format === 'csv' ? 'csv' : 'json';
    const r = await dialog.showSaveDialog(win ?? undefined!, { title: 'カット範囲を書き出す', defaultPath: path.join(app.getPath('documents'), `${sanitizeBasename(path.basename(p.basename, path.extname(p.basename)))}_cuts.${ext}`), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    const cuts = [...p.cutRanges].sort((a, b) => a.startFrame - b.startFrame);
    if (p.format === 'json') {
      const data = { product: 'Maqiri', schemaVersion: 1, algorithmVersion: ALGORITHM_VERSION, fps: OUTPUT_FPS, source: { basename: p.basename, sha256: p.sha256 }, cutRanges: cuts.map((c) => ({ startFrame: c.startFrame, endFrame: c.endFrame, reason: c.reason })) };
      await atomicWriteFile(r.filePath, JSON.stringify(data, null, 2) + '\n', false);
    } else {
      const rows = [['source_basename', 'source_sha256', 'fps', 'algorithm'].map(csvCell).join(','), [p.basename, p.sha256, String(OUTPUT_FPS), ALGORITHM_VERSION].map(csvCell).join(','), '', ['index', 'startFrame', 'endFrame', 'startTimecode', 'endTimecode', 'removedFrames', 'reason'].map(csvCell).join(',')];
      cuts.forEach((c, i) => rows.push([i + 1, c.startFrame, c.endFrame, formatFrameTimecode(c.startFrame), formatFrameTimecode(c.endFrame), c.endFrame - c.startFrame, c.reason].map(csvCell).join(',')));
      await atomicWriteFile(r.filePath, '﻿' + rows.join('\r\n') + '\r\n', false);
    }
    return { basename: path.basename(r.filePath) };
  }

  // ---------- その他 ----------
  getInfo(): AppInfo {
    return {
      edition: this.deps.edition,
      version: this.deps.appVersion,
      platform: process.platform,
      toolsKind: this.tools?.kind ?? 'missing',
      ffmpegVersion: this.ffmpegVersion,
      encoderStatus: this.encoderStatus,
      demoSeconds: DEMO_SECONDS,
      maxMinutes: MAX_SOURCE_DURATION_SECONDS / 60
    };
  }

  async cacheInfo(): Promise<CacheInfo> {
    return { totalBytes: await this.cache.totalBytes(), limitBytes: this.cache.limit };
  }

  async clearCache(): Promise<CacheInfo> {
    this.jobs.cancelKind('preview');
    this.cache.releaseAll();
    await this.cache.clearAll();
    return this.cacheInfo();
  }

  async diagnostics(): Promise<{ text: string }> {
    return { text: await readLogTail() };
  }

  async getSettings(): Promise<{ outputPreset: OutputPresetId; cacheLimitBytes: number }> {
    const s = this.settings.get();
    return { outputPreset: s.outputPreset, cacheLimitBytes: s.cacheLimitBytes };
  }

  async setSettings(p: IpcPayload<'settings:set'>): Promise<{ outputPreset: OutputPresetId; cacheLimitBytes: number }> {
    const patch: Partial<{ outputPreset: OutputPresetId; cacheLimitBytes: number }> = {};
    if (p.outputPreset) patch.outputPreset = p.outputPreset;
    if (p.cacheLimitBytes) patch.cacheLimitBytes = p.cacheLimitBytes;
    const s = await this.settings.update(patch);
    this.cache.setLimit(s.cacheLimitBytes);
    return { outputPreset: s.outputPreset, cacheLimitBytes: s.cacheLimitBytes };
  }

  listRecovery(): RecoveryInfo[] {
    return [...this.recovery.entries()].map(([token, c]) => ({ recoveryToken: token, title: c.title, modifiedAt: c.modifiedAt }));
  }

  async resolveRecovery(token: string, action: 'restore' | 'discard'): Promise<{ ok: boolean }> {
    const c = this.recovery.get(token);
    if (!c) throw new AppError('E_IPC', '回復候補が見つかりません。');
    await resolveRecovery(c, action);
    this.recovery.delete(token);
    return { ok: true };
  }

  openHelp(topic: 'formats' | 'license' | 'privacy'): { ok: boolean } {
    const allow: Record<string, string> = { license: 'https://ffmpeg.org/legal.html' };
    const url = allow[topic];
    if (!url) return { ok: false };
    void shell.openExternal(url);
    return { ok: true };
  }

  cancelJob(jobId: string): { cancelled: boolean } {
    return { cancelled: this.jobs.cancel(jobId) };
  }

  /** 保存済みプロジェクトを新規作成用に ID 付与 */
  newProjectId(): string {
    return newProjectId();
  }

  private settle<K extends 'probe' | 'hash' | 'analysis' | 'preview' | 'export'>(jobId: string, kind: K, result: Promise<unknown>): void {
    result
      .then((r) => this.emit({ type: 'job:done', jobId, kind, result: r as never }))
      .catch(async (e: unknown) => {
        const err = toAppError(e);
        if (err.code !== 'E_CANCELLED') await log('error', `job ${kind} failed`, err.toJSON());
        this.emit({ type: 'job:failed', jobId, kind, error: err.toJSON() });
      });
  }
}

function sanitizeBasename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned.length ? cleaned.slice(0, 120) : 'maqiri';
}

/** 絶対パスを隠し、末尾のフォルダー名だけ見せる。 */
function displayFolder(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : parts.join('/');
}

export async function readTextFileLimited(file: string, limit = 64 * 1024): Promise<string> {
  const text = await readFile(file, 'utf8');
  return text.length > limit ? text.slice(-limit) : text;
}

export { writeFile as _writeFile };
