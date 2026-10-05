// Electron main: ウィンドウ、セキュリティ設定、プロトコル、IPC、起動時診断。
import { app, BrowserWindow, Menu, session, shell, dialog } from 'electron';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { AppError, toAppError } from '@shared/errors';
import { installMediaProtocol, registerMediaSchemeAsPrivileged, MEDIA_SCHEME } from './protocol';
import { AppController } from './controller';
import { registerIpc } from './ipc';
import { initLog, log } from './log';
import { currentEdition } from './edition';

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL'];
const edition = currentEdition();

registerMediaSchemeAsPrivileged();

// E2E テスト用(非パッケージ版のみ): userData を隔離する
if (!app.isPackaged && process.env['MAQIRI_E2E_USER_DATA']) {
  app.setPath('userData', process.env['MAQIRI_E2E_USER_DATA']);
}

// 二重起動を防ぐ(ジョブ/キャッシュの競合を避ける)
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let controller: AppController | null = null;

function devServerOrigin(): string | null {
  const url = process.env['ELECTRON_RENDERER_URL'];
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function cspFor(): string {
  const dev = devServerOrigin();
  const scriptSrc = dev ? `'self' ${dev}` : `'self'`;
  const connect = dev ? `'self' ${dev} ws://${new URL(dev).host}` : `'self'`;
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'${dev ? ` ${dev}` : ''}`,
    `img-src 'self' data: blob:${dev ? ` ${dev}` : ''}`,
    `font-src 'self' data:${dev ? ` ${dev}` : ''}`,
    `media-src 'self' ${MEDIA_SCHEME}: blob:`,
    `connect-src ${connect}`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `frame-ancestors 'none'`
  ].join('; ');
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 700,
    show: false,
    backgroundColor: '#EFE6D8',
    title: edition === 'demo' ? 'Maqiri（デモ版）' : 'Maqiri',
    icon: path.join(process.resourcesPath ?? '', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev
    }
  });
  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  // 新規ウィンドウ/外部ナビゲーションを拒否
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    const dev = devServerOrigin();
    if (!(dev && url.startsWith(dev)) && !url.startsWith('file:')) e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.on('closed', () => {
    mainWindow = null;
  });
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function buildMenu(): void {
  const send = (action: 'open-project' | 'save-project-as' | 'open-source' | 'settings') => controller?.emit({ type: 'menu:action', action });
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'ファイル',
      submenu: [
        { label: '動画を選ぶ…', accelerator: 'CmdOrCtrl+O', click: () => send('open-source') },
        { label: 'プロジェクトを開く…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('open-project') },
        { label: 'プロジェクトを別名で保存…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-project-as') },
        { type: 'separator' },
        { label: '設定', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
        { type: 'separator' },
        { role: 'quit', label: '終了' }
      ]
    },
    {
      label: '表示',
      submenu: [{ role: 'resetZoom', label: '表示倍率を戻す' }, { role: 'zoomIn', label: '拡大' }, { role: 'zoomOut', label: '縮小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全画面' }, ...(isDev ? [{ role: 'toggleDevTools' as const }] : [])]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  await mkdir(userData, { recursive: true });
  initLog(userData);
  await log('info', `start edition=${edition} version=${app.getVersion()} electron=${process.versions.electron} platform=${process.platform}`);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [cspFor()] } });
  });
  // レンダラーからの権限要求はすべて拒否(カメラ/マイク/通知等は不要)
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  installMediaProtocol();

  // 開発時(out/main/index.js を直接起動)は out/main → リポジトリ root を基準にする
  const devRoot = path.resolve(__dirname, '..', '..');
  const resourcesRoot = app.isPackaged ? process.resourcesPath : path.join(devRoot, 'resources');
  controller = new AppController({
    edition,
    userDataDir: userData,
    resourcesDir: resourcesRoot,
    appVersion: app.isPackaged ? app.getVersion() : readDevVersion(devRoot),
    workerPath: path.join(__dirname, 'analysis-worker.js'),
    getWindow: () => mainWindow,
    isDev
  });
  registerIpc(controller, () => mainWindow, devServerOrigin());
  buildMenu();
  await createWindow();
  controller.startupChecks().catch(async (e: unknown) => {
    const err = toAppError(e);
    await log('error', 'startup checks failed', err.toJSON());
    controller?.emit({ type: 'app:toolsError', error: err.toJSON() });
  });
});

app.on('window-all-closed', () => {
  controller?.shutdown().finally(() => app.quit());
});

app.on('before-quit', () => {
  controller?.cancelAllJobs();
});

process.on('uncaughtException', (e) => {
  void log('error', 'uncaughtException', e instanceof Error ? e.stack ?? e.message : String(e));
  if (!(e instanceof AppError) && mainWindow) {
    dialog.showErrorBox('Maqiri', '予期しないエラーが発生しました。診断ログを確認してください。');
  }
});

function readDevVersion(root: string): string {
  try {
    return (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

// 外部リンクは固定の HTTPS allowlist のみ(controller から呼ぶ)
export function openExternalAllowed(url: string): boolean {
  const allow = ['https://github.com/BtbN/FFmpeg-Builds', 'https://ffmpeg.org/legal.html', 'https://www.electronjs.org/'];
  if (!allow.some((a) => url.startsWith(a))) return false;
  void shell.openExternal(url);
  return true;
}
