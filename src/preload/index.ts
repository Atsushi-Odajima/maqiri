// preload: 許可済み API だけを公開する。任意の readFile/spawn/shell は公開しない。
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcChannel, IpcPayload } from '@shared/schemas';
import type { IpcResult, MainEvent } from '@shared/ipc';
import { EVENT_CHANNEL, IPC_CHANNELS } from '@shared/channels';

// sandbox 化された preload では node_modules を require できないため、zod を含むモジュールは型だけ参照する。
const ALLOWED = new Set<string>(IPC_CHANNELS);

async function invoke<C extends IpcChannel>(channel: C, payload: IpcPayload<C>): Promise<IpcResult<C>> {
  if (!ALLOWED.has(channel)) throw new Error(`channel not allowed: ${channel}`);
  return (await ipcRenderer.invoke(channel, payload)) as IpcResult<C>;
}

const api = {
  invoke,
  onEvent(handler: (event: MainEvent) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, ev: MainEvent) => handler(ev);
    ipcRenderer.on(EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, listener);
  },
  platform: process.platform
};

export type MaqiriApi = typeof api;

contextBridge.exposeInMainWorld('maqiri', api);
