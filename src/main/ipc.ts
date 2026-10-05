// IPC 登録: sender を検証し、payload を Zod で検証してから controller を呼ぶ。
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { AppError, toAppError } from '@shared/errors';
import { ipcSchemas, type IpcChannel, type IpcPayload } from '@shared/schemas';
import type { IpcResult } from '@shared/ipc';
import type { AppController } from './controller';
import { log } from './log';

type Handler<C extends IpcChannel> = (payload: IpcPayload<C>) => Promise<IpcResult<C>> | IpcResult<C>;

export function registerIpc(controller: AppController, getWindow: () => BrowserWindow | null, devOrigin: string | null): void {
  function verifySender(event: IpcMainInvokeEvent): void {
    const win = getWindow();
    if (!win || event.sender.id !== win.webContents.id) throw new AppError('E_IPC', '不正な呼び出し元です。');
    const frame = event.senderFrame;
    if (!frame || frame !== win.webContents.mainFrame) throw new AppError('E_IPC', '不正なフレームからの呼び出しです。');
    const url = frame.url;
    const ok = url.startsWith('file://') || (devOrigin !== null && url.startsWith(devOrigin));
    if (!ok) throw new AppError('E_IPC', '不正なオリジンからの呼び出しです。');
  }

  function handle<C extends IpcChannel>(channel: C, fn: Handler<C>): void {
    ipcMain.handle(channel, async (event, raw: unknown) => {
      try {
        verifySender(event);
        const parsed = ipcSchemas[channel].safeParse(raw ?? {});
        if (!parsed.success) {
          throw new AppError('E_IPC', '要求の内容が不正です。', { detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
        }
        return await fn(parsed.data as IpcPayload<C>);
      } catch (e) {
        const err = toAppError(e);
        if (err.code === 'E_INTERNAL' || err.code === 'E_IPC') await log('warn', `ipc ${channel} failed: ${err.message}`, err.detail);
        // renderer へは JSON 化したエラーを投げる(Electron は Error を文字列化するため構造を保つ)
        throw new Error(JSON.stringify(err.toJSON()));
      }
    });
  }

  handle('source:pick', () => controller.pickSource());
  handle('source:useSample', () => controller.useSample());
  handle('source:probe', (p) => controller.startProbe(p.assetId));
  handle('source:hash', (p) => controller.startHash(p.assetId));
  handle('source:selectAudio', (p) => controller.selectAudio(p.assetId, p.audioStreamIndex));
  handle('analysis:start', (p) => controller.startAnalysis(p.assetId));
  handle('job:cancel', (p) => controller.cancelJob(p.jobId));
  handle('junction:generate', (p) => controller.startJunction(p));
  handle('preview:render', (p) => controller.startPreviewRender(p));
  handle('export:pickDestination', (p) => controller.pickDestination(p));
  handle('export:start', (p) => controller.startExport(p));
  handle('export:openResult', (p) => controller.openResult(p.exportToken, p.action));
  handle('project:save', (p) => controller.saveProject(p));
  handle('project:open', (p) => controller.openProject(p.projectId));
  handle('project:relink', (p) => controller.relinkProject(p.projectId));
  handle('project:listRecent', () => controller.listRecent());
  handle('project:exportCuts', (p) => controller.exportCuts(p));
  handle('app:getInfo', () => controller.getInfo());
  handle('app:openHelp', (p) => controller.openHelp(p.topic));
  handle('cache:clear', () => controller.clearCache());
  handle('cache:info', () => controller.cacheInfo());
  handle('diagnostics:read', () => controller.diagnostics());
  handle('settings:get', () => controller.getSettings());
  handle('settings:set', (p) => controller.setSettings(p));
  handle('recovery:list', () => controller.listRecovery());
  handle('recovery:resolve', (p) => controller.resolveRecovery(p.recoveryToken, p.action));
}
