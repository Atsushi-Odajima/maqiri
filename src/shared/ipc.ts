// IPC チャンネルの結果型とイベント型。preload は許可済みチャンネルだけを転送する。
import type { IpcChannel } from './schemas';
import type { AnalysisWindows, DestinationInfo, Edition, EncoderStatus, ExportReport, JobKind, JobProgress, JunctionPreview, RecentProjectEntry, SelectedSource, SourceInfo } from './types';
import type { AppErrorShape } from './errors';
import type { ProjectFile } from './schemas';

export interface PickedSource {
  assetId: string;
  basename: string;
  isSample: boolean;
}

export interface ProbeResult {
  info: SourceInfo;
  proposedAudioStreamIndex: number;
  limitFrames: number;
  edition: Edition;
}

export interface JobStarted {
  jobId: string;
}

export interface AppInfo {
  edition: Edition;
  version: string;
  platform: string;
  toolsKind: 'bundled-win32' | 'system-dev' | 'missing';
  ffmpegVersion: string;
  encoderStatus: EncoderStatus | null;
  demoSeconds: number;
  maxMinutes: number;
}

export interface CacheInfo {
  totalBytes: number;
  limitBytes: number;
}

export interface RecoveryInfo {
  recoveryToken: string;
  title: string | null;
  modifiedAt: string;
}

export interface LoadedProject {
  project: Omit<ProjectFile, 'source'> & { source: Omit<ProjectFile['source'], 'absolutePath'> };
  /** 元素材が見つかり hash が一致した場合に発行 */
  selected: (SelectedSource & { mediaUrl: string }) | null;
  /** 見つからない/不一致の理由 */
  sourceStatus: 'ok' | 'missing' | 'hash-mismatch';
  projectBasename: string;
}

export type IpcResultMap = {
  'source:pick': PickedSource | null;
  'source:useSample': PickedSource;
  'source:probe': JobStarted;
  'source:hash': JobStarted;
  'source:selectAudio': SelectedSource & { mediaUrl: string };
  'analysis:start': JobStarted;
  'job:cancel': { cancelled: boolean };
  'junction:generate': JobStarted;
  'preview:render': JobStarted;
  'export:pickDestination': DestinationInfo | null;
  'export:start': JobStarted;
  'export:openResult': { ok: boolean };
  'project:save': { projectBasename: string; savedAt: string };
  'project:open': LoadedProject | null;
  'project:relink': LoadedProject | null;
  'project:listRecent': RecentProjectEntry[];
  'project:exportCuts': { basename: string } | null;
  'app:getInfo': AppInfo;
  'app:openHelp': { ok: boolean };
  'cache:clear': CacheInfo;
  'cache:info': CacheInfo;
  'diagnostics:read': { text: string };
  'settings:get': { outputPreset: '1080p30' | '720p30'; cacheLimitBytes: number };
  'settings:set': { outputPreset: '1080p30' | '720p30'; cacheLimitBytes: number };
  'recovery:list': RecoveryInfo[];
  'recovery:resolve': { ok: boolean };
};

export type IpcResult<C extends IpcChannel> = C extends keyof IpcResultMap ? IpcResultMap[C] : never;

export interface RenderedPreview {
  kind: 'proxy' | 'full';
  revision: number;
  mediaUrl: string;
  frames: number;
}

export type JobResultMap = {
  probe: ProbeResult;
  hash: { sha256: string };
  analysis: AnalysisWindows;
  preview: JunctionPreview | RenderedPreview;
  export: ExportReport & { exportToken: string };
  selftest: EncoderStatus;
};

export type MainEvent =
  | { type: 'job:progress'; progress: JobProgress }
  | { type: 'job:done'; jobId: string; kind: JobKind; result: JobResultMap[JobKind] }
  | { type: 'job:failed'; jobId: string; kind: JobKind; error: AppErrorShape }
  | { type: 'app:encoderStatus'; status: EncoderStatus }
  | { type: 'app:recovery'; candidates: RecoveryInfo[] }
  | { type: 'app:toolsError'; error: AppErrorShape }
  | { type: 'menu:action'; action: 'open-project' | 'save-project-as' | 'open-source' | 'settings' };

export { EVENT_CHANNEL } from './channels';
