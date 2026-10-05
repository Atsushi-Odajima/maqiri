// プロジェクト IO: .maqiri.json(UTF-8, schemaVersion=1)、自動保存、.bak、回復候補、最近の一覧、再リンク。
import { readFile, readdir, rename, stat, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors';
import { projectHeaderSchema, projectSchema, recentFileSchema, type ProjectFile } from '@shared/schemas';
import { atomicWriteFile, safeUnlink } from './fsutil';

export interface ProjectStore {
  projectsDir: string;
  recentPath: string;
}

export function createProjectStore(userDataDir: string): ProjectStore {
  return { projectsDir: path.join(userDataDir, 'projects'), recentPath: path.join(userDataDir, 'recent.json') };
}

export function projectFilePath(store: ProjectStore, projectId: string): string {
  return path.join(store.projectsDir, `${projectId}.maqiri.json`);
}

export function newProjectId(): string {
  return randomUUID();
}

export async function saveProject(file: string, project: ProjectFile): Promise<void> {
  const parsed = projectSchema.parse(project); // 保存前にも検証
  const json = JSON.stringify(parsed, null, 2) + '\n';
  await atomicWriteFile(file, json, true);
}

export async function loadProjectFile(file: string): Promise<ProjectFile> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new AppError('E_READ', 'プロジェクトファイルを読み込めません。', { nextAction: 'ファイルの場所を確認してください。' });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError('E_PROJECT_SCHEMA', 'プロジェクトファイルの内容を読み取れません(JSON ではありません)。');
  }
  const header = projectHeaderSchema.safeParse(raw);
  if (!header.success || header.data.product !== 'Maqiri') {
    throw new AppError('E_PROJECT_SCHEMA', 'Maqiri のプロジェクトファイルではありません。');
  }
  if (header.data.schemaVersion !== 1) {
    throw new AppError('E_PROJECT_SCHEMA', `このプロジェクトは新しい形式(schemaVersion ${header.data.schemaVersion})です。編集せずに終了します。`, { nextAction: 'アプリを更新してから開いてください。' });
  }
  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('E_PROJECT_SCHEMA', 'プロジェクトファイルの内容が不正です。編集せずに終了します。', { detail: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  }
  return parsed.data;
}

export interface RecentEntryInternal {
  projectId: string;
  title: string;
  sourceBasename: string;
  updatedAt: string;
  projectPath: string;
}

export async function readRecent(store: ProjectStore): Promise<RecentEntryInternal[]> {
  try {
    const raw = JSON.parse(await readFile(store.recentPath, 'utf8'));
    const parsed = recentFileSchema.safeParse(raw);
    return parsed.success ? parsed.data.entries : [];
  } catch {
    return [];
  }
}

export async function touchRecent(store: ProjectStore, entry: RecentEntryInternal): Promise<void> {
  const list = (await readRecent(store)).filter((e) => e.projectId !== entry.projectId);
  list.unshift(entry);
  await atomicWriteFile(store.recentPath, JSON.stringify({ entries: list.slice(0, 20) }, null, 2), false);
}

export async function removeRecent(store: ProjectStore, projectId: string): Promise<void> {
  const list = (await readRecent(store)).filter((e) => e.projectId !== projectId);
  await atomicWriteFile(store.recentPath, JSON.stringify({ entries: list }, null, 2), false);
}

export interface RecoveryCandidate {
  tmpPath: string;
  targetPath: string;
  modifiedAt: string;
  title: string | null;
}

/** 起動時: 書き込み途中の .tmp を回復候補として列挙する(元へ無断上書きしない)。 */
export async function listRecoveryCandidates(store: ProjectStore): Promise<RecoveryCandidate[]> {
  const out: RecoveryCandidate[] = [];
  try {
    await mkdir(store.projectsDir, { recursive: true });
    for (const name of await readdir(store.projectsDir)) {
      if (!name.endsWith('.maqiri.json.tmp')) continue;
      const tmpPath = path.join(store.projectsDir, name);
      const st = await stat(tmpPath);
      let title: string | null = null;
      try {
        const raw = JSON.parse(await readFile(tmpPath, 'utf8')) as { title?: unknown };
        if (typeof raw.title === 'string') title = raw.title;
      } catch {
        /* 壊れた tmp */
      }
      out.push({ tmpPath, targetPath: tmpPath.slice(0, -'.tmp'.length), modifiedAt: st.mtime.toISOString(), title });
    }
  } catch {
    /* ignore */
  }
  return out;
}

export async function resolveRecovery(c: RecoveryCandidate, action: 'restore' | 'discard'): Promise<void> {
  if (action === 'discard') {
    await safeUnlink(c.tmpPath);
    return;
  }
  // 復元: tmp を検証してから、現在の正本を .bak に退避して置き換える
  const text = await readFile(c.tmpPath, 'utf8');
  const parsed = projectSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    await safeUnlink(c.tmpPath);
    throw new AppError('E_PROJECT_SCHEMA', '回復候補の内容が不正だったため破棄しました。');
  }
  try {
    await stat(c.targetPath);
    await rename(c.targetPath, `${c.targetPath}.bak`);
  } catch {
    /* no current */
  }
  await rename(c.tmpPath, c.targetPath);
}

export async function deleteProjectFiles(file: string): Promise<void> {
  await safeUnlink(file);
  await safeUnlink(`${file}.bak`);
  await safeUnlink(`${file}.tmp`);
  try {
    await unlink(`${file}.tmp`);
  } catch {
    /* ignore */
  }
}
