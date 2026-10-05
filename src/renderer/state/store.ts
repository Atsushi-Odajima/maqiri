// Zustand ストア。編集状態(設定/保持/延長)は Undo 履歴付き。解析進捗は履歴に入れない。
import { create } from 'zustand';
import { analyze, type AnalysisResult } from '@domain/analysis';
import { createHistory, pushHistory, redo as redoHistory, undo as undoHistory, canRedo, canUndo, type History } from '@domain/history';
import type { KeepRange, ManualCutRange, CandidateView } from '@domain/keeps';
import { DEFAULT_SETTINGS, normalizeSettings, settingsFromPreset, type AnalysisSettings } from '@domain/settings';
import { candidateBounds, breaksProtectivePad } from '@domain/analysis';
import { unionRanges, type FrameRange } from '@domain/ranges';
import { ALGORITHM_VERSION, type OutputPresetId, type PresetId } from '@shared/constants';
import type { AppErrorShape } from '@shared/errors';
import type { AppInfo, LoadedProject, PickedSource, ProbeResult, RecoveryInfo } from '@shared/ipc';
import type { AnalysisWindows, EncoderStatus, ExportReport, JunctionPreview, RecentProjectEntry, SelectedSource } from '@shared/types';
import { invoke, runJob, subscribe, type JobHandle } from './api';

export type Screen = 'start' | 'load' | 'edit' | 'done' | 'settings';

export interface EditorState {
  settings: AnalysisSettings;
  keeps: KeepRange[];
  manualCuts: ManualCutRange[];
}

export interface LoadProgress {
  stage: string;
  ratio: number | null;
}

export interface JunctionState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'stale';
  preview: JunctionPreview | null;
  error: AppErrorShape | null;
  candidateId: string | null;
  revision: number;
}

export interface ExportState {
  open: boolean;
  destination: import('@shared/types').DestinationInfo | null;
  job: JobHandle<'export'> | null;
  progress: LoadProgress | null;
  report: (ExportReport & { exportToken: string }) | null;
  error: AppErrorShape | null;
  includeUnreviewed: boolean;
  outputPreset: OutputPresetId;
}

interface State {
  appInfo: AppInfo | null;
  encoderStatus: EncoderStatus | null;
  toolsError: AppErrorShape | null;
  screen: Screen;
  returnScreen: Screen;
  recent: RecentProjectEntry[];
  recovery: RecoveryInfo[];

  picked: PickedSource | null;
  probe: ProbeResult | null;
  sha256: string | null;
  selected: (SelectedSource & { mediaUrl: string }) | null;
  loadProgress: LoadProgress | null;
  loadError: AppErrorShape | null;
  needsAudioChoice: boolean;
  loadJobs: Array<JobHandle<'probe'> | JobHandle<'hash'> | JobHandle<'analysis'>>;

  windows: AnalysisWindows | null;
  analysisProgress: LoadProgress | null;
  analysisError: AppErrorShape | null;

  history: History<EditorState>;
  revision: number;
  result: AnalysisResult | null;
  selectedCandidateId: string | null;
  reviewed: Set<string>;
  edgeWarning: string | null;

  projectId: string | null;
  title: string;
  projectBasename: string | null;
  lastSavedAt: string | null;
  saveError: AppErrorShape | null;
  dirty: boolean;

  junction: JunctionState;
  exportState: ExportState;
  /** HEVC 等の元プレビュー用 720p proxy と、全体の確定プレビュー(低画質) */
  proxy: { status: 'none' | 'loading' | 'ready' | 'error'; error: AppErrorShape | null };
  fullPreview: { status: 'idle' | 'loading' | 'ready' | 'error' | 'stale'; mediaUrl: string | null; revision: number; progress: LoadProgress | null; error: AppErrorShape | null; open: boolean };
  globalError: AppErrorShape | null;
}

interface Actions {
  init(): Promise<void>;
  goto(screen: Screen): void;
  openSettingsScreen(): void;
  closeSettingsScreen(): void;
  pickSource(): Promise<void>;
  useSample(): Promise<void>;
  openProject(projectId: string | null): Promise<void>;
  relinkProject(): Promise<void>;
  chooseAudio(streamIndex: number): Promise<void>;
  cancelLoad(): Promise<void>;
  resetToStart(): void;

  applyPreset(id: PresetId): void;
  setSettings(patch: Partial<AnalysisSettings>): void;
  toggleKeep(candidateId: string): void;
  adjustEdge(candidateId: string, edge: 'start' | 'end', deltaFrames: number): void;
  resetKeeps(): void;
  undo(): void;
  redo(): void;
  selectCandidate(id: string | null): void;
  markReviewed(id: string): void;

  requestJunction(): Promise<void>;
  requestProxy(): Promise<void>;
  requestFullPreview(): Promise<void>;
  closeFullPreview(): void;
  openExport(): void;
  closeExport(): void;
  setExportPreset(p: OutputPresetId): void;
  setIncludeUnreviewed(v: boolean): void;
  pickDestination(): Promise<void>;
  startExport(): Promise<void>;
  cancelExport(): Promise<void>;
  openResult(action: 'play' | 'reveal'): Promise<void>;
  backToEdit(): void;

  saveProject(saveAs: boolean): Promise<void>;
  exportCuts(format: 'csv' | 'json'): Promise<void>;
  setTitle(t: string): void;
  resolveRecovery(token: string, action: 'restore' | 'discard'): Promise<void>;
  clearGlobalError(): void;
}

export type Store = State & Actions;

function newLocalId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function recompute(s: Pick<State, 'windows' | 'history' | 'selected'>): AnalysisResult | null {
  if (!s.windows || !s.selected) return null;
  const e = s.history.present;
  return analyze(s.windows.windowDb, e.settings, s.selected.limitFrames, e.keeps, e.manualCuts);
}

export const useStore = create<Store>((set, get) => {
  function commit(next: EditorState): void {
    const s = get();
    const history = pushHistory(s.history, next);
    const revision = s.revision + 1;
    const result = recompute({ ...s, history });
    set({ history, revision, result, dirty: true, junction: s.junction.status === 'idle' ? s.junction : { ...s.junction, status: s.junction.revision === revision ? s.junction.status : 'stale' }, fullPreview: s.fullPreview.status === 'ready' ? { ...s.fullPreview, status: 'stale' } : s.fullPreview });
  }

  function afterHistoryChange(history: History<EditorState>): void {
    const s = get();
    const revision = s.revision + 1;
    const result = recompute({ ...s, history });
    set({ history, revision, result, dirty: true, junction: s.junction.status === 'idle' ? s.junction : { ...s.junction, status: 'stale' }, fullPreview: s.fullPreview.status === 'ready' ? { ...s.fullPreview, status: 'stale' } : s.fullPreview });
  }

  function fail(err: unknown): AppErrorShape {
    const e = err as AppErrorShape;
    return e && typeof e === 'object' && 'code' in e ? e : { code: 'E_INTERNAL', message: String(err) };
  }

  async function loadSelected(selected: SelectedSource & { mediaUrl: string }, editor?: EditorState, project?: { id: string; title: string; basename: string | null }): Promise<void> {
    const windowsJob = await runJob('analysis', 'analysis:start', { assetId: selected.assetId }, (p) => set({ analysisProgress: { stage: p.stage, ratio: p.ratio } }));
    set((s) => ({ loadJobs: [...s.loadJobs, windowsJob], analysisProgress: { stage: '音量を解析中', ratio: 0 } }));
    try {
      const windows = await windowsJob.result;
      const history = createHistory<EditorState>(editor ?? { settings: { ...DEFAULT_SETTINGS }, keeps: [], manualCuts: [] });
      const result = recompute({ windows, history, selected });
      set({
        windows,
        history,
        result,
        revision: 1,
        analysisProgress: null,
        screen: 'edit',
        selectedCandidateId: result?.candidates.find((c) => c.status !== 'kept')?.id ?? null,
        reviewed: new Set(),
        projectId: project?.id ?? crypto.randomUUID(),
        title: project?.title ?? selected.basename.replace(/\.[^.]+$/, ''),
        projectBasename: project?.basename ?? null,
        dirty: !project,
        junction: { status: 'idle', preview: null, error: null, candidateId: null, revision: 0 },
        exportState: { ...get().exportState, report: null, error: null },
        proxy: { status: 'none', error: null },
        fullPreview: { status: 'idle', mediaUrl: null, revision: 0, progress: null, error: null, open: false }
      });
      // HEVC はブラウザで再生できないことがあるため、元プレビュー用の 720p proxy を作る(時刻は正規化後と一致)
      if (selected.codec === 'hevc') void get().requestProxy();
    } catch (e) {
      set({ analysisError: fail(e), analysisProgress: null, loadError: fail(e) });
    }
  }

  return {
    appInfo: null,
    encoderStatus: null,
    toolsError: null,
    screen: 'start',
    returnScreen: 'start',
    recent: [],
    recovery: [],
    picked: null,
    probe: null,
    sha256: null,
    selected: null,
    loadProgress: null,
    loadError: null,
    needsAudioChoice: false,
    loadJobs: [],
    windows: null,
    analysisProgress: null,
    analysisError: null,
    history: createHistory<EditorState>({ settings: { ...DEFAULT_SETTINGS }, keeps: [], manualCuts: [] }),
    revision: 0,
    result: null,
    selectedCandidateId: null,
    reviewed: new Set<string>(),
    edgeWarning: null,
    projectId: null,
    title: '',
    projectBasename: null,
    lastSavedAt: null,
    saveError: null,
    dirty: false,
    junction: { status: 'idle', preview: null, error: null, candidateId: null, revision: 0 },
    exportState: { open: false, destination: null, job: null, progress: null, report: null, error: null, includeUnreviewed: false, outputPreset: '1080p30' },
    proxy: { status: 'none', error: null },
    fullPreview: { status: 'idle', mediaUrl: null, revision: 0, progress: null, error: null, open: false },
    globalError: null,

    async init() {
      subscribe((ev) => {
        if (ev.type === 'app:encoderStatus') set({ encoderStatus: ev.status, appInfo: get().appInfo ? { ...get().appInfo!, encoderStatus: ev.status } : get().appInfo });
        if (ev.type === 'app:toolsError') set({ toolsError: ev.error });
        if (ev.type === 'app:recovery') set({ recovery: ev.candidates });
        if (ev.type === 'menu:action') {
          if (ev.action === 'open-source') void get().pickSource();
          if (ev.action === 'open-project') void get().openProject(null);
          if (ev.action === 'save-project-as') void get().saveProject(true);
          if (ev.action === 'settings') get().openSettingsScreen();
        }
      });
      try {
        const [info, recent, settings] = await Promise.all([invoke('app:getInfo', {}), invoke('project:listRecent', {}), invoke('settings:get', {})]);
        set({ appInfo: info, encoderStatus: info.encoderStatus, recent, exportState: { ...get().exportState, outputPreset: settings.outputPreset } });
      } catch (e) {
        set({ globalError: fail(e) });
      }
    },

    goto(screen) {
      set({ screen });
    },
    openSettingsScreen() {
      const s = get();
      if (s.screen !== 'settings') set({ returnScreen: s.screen, screen: 'settings' });
    },
    closeSettingsScreen() {
      set({ screen: get().returnScreen });
    },

    async pickSource() {
      try {
        const picked = await invoke('source:pick', {});
        if (!picked) return;
        await startLoad(picked);
      } catch (e) {
        set({ loadError: fail(e), screen: 'load' });
      }
    },
    async useSample() {
      try {
        const picked = await invoke('source:useSample', {});
        await startLoad(picked);
      } catch (e) {
        set({ loadError: fail(e), screen: 'load' });
      }
    },

    async openProject(projectId) {
      try {
        const loaded = await invoke('project:open', { projectId });
        if (!loaded) return;
        await applyLoadedProject(loaded);
      } catch (e) {
        set({ loadError: fail(e), screen: 'load' });
      }
    },
    async relinkProject() {
      const id = get().projectId;
      if (!id) return;
      try {
        const loaded = await invoke('project:relink', { projectId: id });
        if (!loaded) return;
        await applyLoadedProject(loaded);
      } catch (e) {
        set({ loadError: fail(e) });
      }
    },

    async chooseAudio(streamIndex) {
      const s = get();
      if (!s.picked || !s.probe || !s.sha256) return;
      try {
        set({ needsAudioChoice: false, loadProgress: { stage: '音声トラックを確認中', ratio: null } });
        const selected = await invoke('source:selectAudio', { assetId: s.picked.assetId, audioStreamIndex: streamIndex });
        set({ selected, loadProgress: null });
        await loadSelected(selected);
      } catch (e) {
        set({ loadError: fail(e), loadProgress: null });
      }
    },

    async cancelLoad() {
      for (const j of get().loadJobs) await j.cancel();
      set({ loadJobs: [], screen: 'start', loadProgress: null, analysisProgress: null, loadError: null, picked: null, probe: null, sha256: null, selected: null, needsAudioChoice: false });
    },

    resetToStart() {
      void invoke('project:listRecent', {}).then((recent) => set({ recent }));
      set({ screen: 'start', picked: null, probe: null, sha256: null, selected: null, windows: null, result: null, loadError: null, analysisError: null, projectId: null, projectBasename: null, selectedCandidateId: null, junction: { status: 'idle', preview: null, error: null, candidateId: null, revision: 0 }, exportState: { ...get().exportState, open: false, destination: null, report: null, error: null, progress: null, job: null } });
    },

    applyPreset(id) {
      const e = get().history.present;
      commit({ ...e, settings: settingsFromPreset(id) });
    },
    setSettings(patch) {
      const e = get().history.present;
      commit({ ...e, settings: normalizeSettings({ ...e.settings, ...patch }) });
    },
    toggleKeep(candidateId) {
      const s = get();
      const cand = s.result?.candidates.find((c) => c.id === candidateId);
      if (!cand) return;
      const e = s.history.present;
      const existing = e.keeps.filter((k) => k.candidateId === candidateId && k.reason === 'user-keep');
      if (existing.length) {
        commit({ ...e, keeps: e.keeps.filter((k) => !(k.candidateId === candidateId && k.reason === 'user-keep')) });
      } else {
        commit({ ...e, keeps: [...e.keeps, { id: newLocalId(), reason: 'user-keep', startFrame: cand.startFrame, endFrame: cand.endFrame, candidateId }] });
      }
    },
    adjustEdge(candidateId, edge, deltaFrames) {
      const s = get();
      const cand = s.result?.candidates.find((c) => c.id === candidateId);
      if (!cand || !s.selected || deltaFrames === 0) return;
      const bounds = candidateBounds(cand, s.selected.limitFrames);
      const e = s.history.present;
      const cur = effectiveEdges(cand, e);
      let proposed: FrameRange = { ...cur };
      if (edge === 'start') proposed = { startFrame: Math.min(cur.endFrame - 1, Math.max(bounds.startFrame, cur.startFrame + deltaFrames)), endFrame: cur.endFrame };
      else proposed = { startFrame: cur.startFrame, endFrame: Math.max(cur.startFrame + 1, Math.min(bounds.endFrame, cur.endFrame + deltaFrames)) };
      if (proposed.startFrame === cur.startFrame && proposed.endFrame === cur.endFrame) return;
      // 保持(縮める)と延長(広げる)に分解
      const keeps = e.keeps.filter((k) => !(k.candidateId === candidateId && k.reason === 'edge-adjust'));
      const manualCuts = e.manualCuts.filter((m) => !m.id.startsWith(`edge:${candidateId}:`));
      if (proposed.startFrame > cand.startFrame) keeps.push({ id: newLocalId(), reason: 'edge-adjust', startFrame: cand.startFrame, endFrame: proposed.startFrame, candidateId });
      if (proposed.endFrame < cand.endFrame) keeps.push({ id: newLocalId(), reason: 'edge-adjust', startFrame: proposed.endFrame, endFrame: cand.endFrame, candidateId });
      if (proposed.startFrame < cand.startFrame) manualCuts.push({ id: `edge:${candidateId}:s`, startFrame: proposed.startFrame, endFrame: cand.startFrame, runStartMs: cand.runStartMs, runEndMs: cand.runEndMs });
      if (proposed.endFrame > cand.endFrame) manualCuts.push({ id: `edge:${candidateId}:e`, startFrame: cand.endFrame, endFrame: proposed.endFrame, runStartMs: cand.runStartMs, runEndMs: cand.runEndMs });
      set({ edgeWarning: breaksProtectivePad(cand, proposed) ? '声の前後を保護する余白を割っています。つなぎ目を確認してください。' : null });
      commit({ ...e, keeps, manualCuts });
    },
    resetKeeps() {
      const e = get().history.present;
      if (e.keeps.length === 0 && e.manualCuts.length === 0) return;
      commit({ ...e, keeps: [], manualCuts: [] });
    },
    undo() {
      const h = get().history;
      if (canUndo(h)) afterHistoryChange(undoHistory(h));
    },
    redo() {
      const h = get().history;
      if (canRedo(h)) afterHistoryChange(redoHistory(h));
    },
    selectCandidate(id) {
      set({ selectedCandidateId: id, edgeWarning: null });
    },
    markReviewed(id) {
      const r = new Set(get().reviewed);
      r.add(id);
      set({ reviewed: r });
    },

    async requestJunction() {
      const s = get();
      const id = s.selectedCandidateId;
      const cand = s.result?.candidates.find((c) => c.id === id);
      if (!s.selected || !cand || !id) return;
      const cut = cand.effective.length ? { startFrame: cand.effective[0]!.startFrame, endFrame: cand.effective[cand.effective.length - 1]!.endFrame } : { startFrame: cand.startFrame, endFrame: cand.endFrame };
      const revision = s.revision;
      set({ junction: { status: 'loading', preview: null, error: null, candidateId: id, revision } });
      try {
        const job = await runJob('preview', 'junction:generate', { assetId: s.selected.assetId, candidateId: `${id}-r${revision}`, revision, cut, outputWidth: 1280, outputHeight: 720 });
        const preview = (await job.result) as JunctionPreview;
        if (get().revision !== revision || get().selectedCandidateId !== id) {
          set({ junction: { status: 'stale', preview, error: null, candidateId: id, revision } });
          return;
        }
        get().markReviewed(id);
        set({ junction: { status: 'ready', preview: { ...preview, candidateId: id }, error: null, candidateId: id, revision } });
      } catch (e) {
        const err = fail(e);
        if (err.code === 'E_CANCELLED') return;
        set({ junction: { status: 'error', preview: null, error: err, candidateId: id, revision } });
      }
    },

    async requestProxy() {
      const s = get();
      if (!s.selected) return;
      set({ proxy: { status: 'loading', error: null } });
      try {
        const job = await runJob('preview', 'preview:render', { assetId: s.selected.assetId, kind: 'proxy', revision: 0, cutRanges: [] });
        const r = (await job.result) as import('@shared/ipc').RenderedPreview;
        const cur = get().selected;
        if (cur && cur.assetId === s.selected.assetId) set({ selected: { ...cur, mediaUrl: r.mediaUrl }, proxy: { status: 'ready', error: null } });
      } catch (e) {
        const err = fail(e);
        if (err.code !== 'E_CANCELLED') set({ proxy: { status: 'error', error: err } });
      }
    },
    async requestFullPreview() {
      const s = get();
      if (!s.selected || !s.result) return;
      const revision = s.revision;
      const cutRanges = unionRanges(s.result.cutRanges.map((c) => ({ startFrame: c.startFrame, endFrame: c.endFrame })));
      set({ fullPreview: { status: 'loading', mediaUrl: null, revision, progress: { stage: '全体の確定プレビューを作成中', ratio: 0 }, error: null, open: true } });
      try {
        const job = await runJob('preview', 'preview:render', { assetId: s.selected.assetId, kind: 'full', revision, cutRanges }, (p) => set((st) => ({ fullPreview: { ...st.fullPreview, progress: { stage: p.stage, ratio: p.ratio } } })));
        const r = (await job.result) as import('@shared/ipc').RenderedPreview;
        set((st) => ({ fullPreview: { ...st.fullPreview, status: get().revision === revision ? 'ready' : 'stale', mediaUrl: r.mediaUrl, revision, progress: null } }));
      } catch (e) {
        const err = fail(e);
        if (err.code === 'E_CANCELLED') {
          set((st) => ({ fullPreview: { ...st.fullPreview, status: 'idle', progress: null, open: false } }));
          return;
        }
        set((st) => ({ fullPreview: { ...st.fullPreview, status: 'error', progress: null, error: err } }));
      }
    },
    closeFullPreview() {
      set((st) => ({ fullPreview: { ...st.fullPreview, open: false } }));
    },
    openExport() {
      set((s) => ({ exportState: { ...s.exportState, open: true, error: null, report: null, destination: null } }));
    },
    closeExport() {
      set((s) => ({ exportState: { ...s.exportState, open: false } }));
    },
    setExportPreset(p) {
      set((s) => ({ exportState: { ...s.exportState, outputPreset: p, destination: null } }));
      void invoke('settings:set', { outputPreset: p }).catch(() => undefined);
    },
    setIncludeUnreviewed(v) {
      set((s) => ({ exportState: { ...s.exportState, includeUnreviewed: v } }));
    },
    async pickDestination() {
      const s = get();
      if (!s.selected || !s.result) return;
      try {
        const dest = await invoke('export:pickDestination', { assetId: s.selected.assetId, suggestedBasename: `${s.selected.basename.replace(/\.[^.]+$/, '')}_maqiri.mp4`, outputPreset: s.exportState.outputPreset, outputFrames: s.result.outputFrames });
        if (dest) set((st) => ({ exportState: { ...st.exportState, destination: dest, error: null } }));
      } catch (e) {
        set((st) => ({ exportState: { ...st.exportState, error: fail(e) } }));
      }
    },
    async startExport() {
      const s = get();
      if (!s.selected || !s.result || !s.exportState.destination) return;
      const cutRanges = unionRanges(s.result.cutRanges.map((c) => ({ startFrame: c.startFrame, endFrame: c.endFrame })));
      try {
        const job = await runJob('export', 'export:start', { assetId: s.selected.assetId, destinationToken: s.exportState.destination.destinationToken, outputPreset: s.exportState.outputPreset, cutRanges, revision: s.revision, settings: s.history.present.settings, projectId: s.projectId, overwriteConfirmed: s.exportState.destination.willOverwrite }, (p) => set((st) => ({ exportState: { ...st.exportState, progress: { stage: p.stage, ratio: p.ratio } } })));
        set((st) => ({ exportState: { ...st.exportState, job, progress: { stage: '書き出しを開始', ratio: 0 }, error: null } }));
        const report = await job.result;
        set((st) => ({ exportState: { ...st.exportState, job: null, progress: null, report, open: false }, screen: 'done' }));
        // lastExport をプロジェクトへ記録
        void get().saveProject(false);
      } catch (e) {
        set((st) => ({ exportState: { ...st.exportState, job: null, progress: null, error: fail(e) } }));
      }
    },
    async cancelExport() {
      await get().exportState.job?.cancel();
    },
    async openResult(action) {
      const token = get().exportState.report?.exportToken;
      if (!token) return;
      try {
        await invoke('export:openResult', { exportToken: token, action });
      } catch (e) {
        set({ globalError: fail(e) });
      }
    },
    backToEdit() {
      set({ screen: 'edit' });
    },

    async saveProject(saveAs) {
      const s = get();
      if (!s.selected || !s.projectId || !s.result) return;
      const now = new Date().toISOString();
      const e = s.history.present;
      try {
        const r = await invoke('project:save', {
          saveAs,
          project: {
            product: 'Maqiri',
            schemaVersion: 1,
            id: s.projectId,
            title: s.title.trim() || 'untitled',
            createdAt: s.lastSavedAt ?? now,
            updatedAt: now,
            assetId: s.selected.assetId,
            settings: { ...e.settings, outputPreset: s.exportState.outputPreset },
            manualKeepRanges: e.keeps.map((k) => (k.candidateId === undefined ? { id: k.id, reason: k.reason, startFrame: k.startFrame, endFrame: k.endFrame } : { id: k.id, reason: k.reason, startFrame: k.startFrame, endFrame: k.endFrame, candidateId: k.candidateId })),
            manualCutRanges: e.manualCuts,
            cutRanges: s.result.cutRanges,
            algorithmVersion: ALGORITHM_VERSION,
            revision: s.revision,
            lastExport: s.exportState.report ? { exportedAt: s.exportState.report.exportedAt, outputBasename: s.exportState.report.outputBasename, outputFrames: s.exportState.report.outputFrames, outputPreset: s.exportState.outputPreset, revision: s.revision } : null
          }
        });
        set({ projectBasename: r.projectBasename, lastSavedAt: r.savedAt, dirty: false, saveError: null });
      } catch (err) {
        set({ saveError: fail(err) });
      }
    },
    async exportCuts(format) {
      const s = get();
      if (!s.selected || !s.result) return;
      try {
        await invoke('project:exportCuts', { assetId: s.selected.assetId, format, cutRanges: s.result.cutRanges, sha256: s.selected.sha256, basename: s.selected.basename });
      } catch (e) {
        set({ globalError: fail(e) });
      }
    },
    setTitle(t) {
      set({ title: t.slice(0, 120), dirty: true });
    },
    async resolveRecovery(token, action) {
      try {
        await invoke('recovery:resolve', { recoveryToken: token, action });
        set((s) => ({ recovery: s.recovery.filter((r) => r.recoveryToken !== token) }));
        const recent = await invoke('project:listRecent', {});
        set({ recent });
      } catch (e) {
        set({ globalError: fail(e) });
      }
    },
    clearGlobalError() {
      set({ globalError: null });
    }
  };

  async function startLoad(picked: PickedSource): Promise<void> {
    set({ picked, screen: 'load', loadError: null, loadProgress: { stage: '読み込みを開始', ratio: null }, probe: null, sha256: null, selected: null, needsAudioChoice: false, loadJobs: [], windows: null, result: null, analysisError: null });
    const probeJob = await runJob('probe', 'source:probe', { assetId: picked.assetId }, (p) => set({ loadProgress: { stage: p.stage, ratio: p.ratio } }));
    const hashJob = await runJob('hash', 'source:hash', { assetId: picked.assetId }, (p) => {
      if (get().probe) set({ loadProgress: { stage: p.stage, ratio: p.ratio } });
    });
    set({ loadJobs: [probeJob, hashJob] });
    try {
      const probe = await probeJob.result;
      set({ probe });
      const { sha256 } = await hashJob.result;
      set({ sha256, loadProgress: null });
      if (probe.info.audioTracks.length > 1) {
        set({ needsAudioChoice: true });
        return;
      }
      await get().chooseAudio(probe.proposedAudioStreamIndex);
    } catch (e) {
      await hashJob.cancel();
      await probeJob.cancel();
      set({ loadError: fail(e), loadProgress: null });
    }
  }

  async function applyLoadedProject(loaded: LoadedProject): Promise<void> {
    const p = loaded.project;
    set({ screen: 'load', loadError: null, picked: { assetId: loaded.selected?.assetId ?? '', basename: p.source.basename, isSample: false }, projectId: p.id, title: p.title, projectBasename: loaded.projectBasename, lastSavedAt: p.updatedAt, loadProgress: null });
    if (loaded.sourceStatus !== 'ok' || !loaded.selected) {
      set({
        loadError: loaded.sourceStatus === 'missing' ? { code: 'E_READ', message: `元の動画「${p.source.basename}」が見つかりません。`, nextAction: '動画を選び直すと、内容(SHA-256)が一致した場合だけ再リンクします。' } : { code: 'E_HASH_MISMATCH', message: '選んだファイルは別の素材です(SHA-256 が一致しません)。', nextAction: '元と同じ動画ファイルを選び直してください。編集結果は適用しませんでした。' },
        selected: null
      });
      return;
    }
    set({ selected: loaded.selected, sha256: loaded.selected.sha256, probe: { info: loaded.selected, proposedAudioStreamIndex: loaded.selected.audioStreamIndex, limitFrames: loaded.selected.limitFrames, edition: get().appInfo?.edition ?? 'demo' }, exportState: { ...get().exportState, outputPreset: p.settings.outputPreset } });
    const { outputPreset: _op, ...settings } = p.settings;
    await loadSelected(loaded.selected, { settings, keeps: p.manualKeepRanges.map((k) => ({ ...k, candidateId: k.candidateId })), manualCuts: p.manualCutRanges }, { id: p.id, title: p.title, basename: loaded.projectBasename });
  }
});

/** 候補の現在の実効端点(保持/延長適用後の最初と最後)。 */
export function effectiveEdges(cand: CandidateView, e: EditorState): FrameRange {
  let start = cand.startFrame;
  let end = cand.endFrame;
  for (const m of e.manualCuts) {
    if (m.id === `edge:${cand.id}:s`) start = m.startFrame;
    if (m.id === `edge:${cand.id}:e`) end = m.endFrame;
  }
  for (const k of e.keeps) {
    if (k.candidateId !== cand.id || k.reason !== 'edge-adjust') continue;
    if (k.startFrame === cand.startFrame) start = Math.max(start, k.endFrame);
    if (k.endFrame === cand.endFrame) end = Math.min(end, k.startFrame);
  }
  return { startFrame: start, endFrame: end };
}

export function selectCanUndo(s: Store): boolean {
  return canUndo(s.history);
}
export function selectCanRedo(s: Store): boolean {
  return canRedo(s.history);
}
