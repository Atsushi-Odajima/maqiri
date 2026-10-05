// Electron 実起動のスモークテスト。ビルド済み out/ を起動し、サンプル読込→解析→書き出しまでを通す。
// ネイティブダイアログは自動化できないため、開発ビルド限定の環境変数(MAQIRI_E2E_*)で保存先を固定する。
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';

const root = path.resolve(import.meta.dirname, '..', '..');
const artifacts = path.join(root, 'tests', 'e2e', '.artifacts');
const exportDir = path.join(artifacts, 'export');
const userData = path.join(artifacts, 'userData');

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  rmSync(artifacts, { recursive: true, force: true });
  mkdirSync(exportDir, { recursive: true });
  mkdirSync(userData, { recursive: true });
  app = await electron.launch({
    args: [path.join(root, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, MAQIRI_E2E_EXPORT_DIR: exportDir, MAQIRI_E2E_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('S0 renders brand start screen with primary action and conditions', async () => {
  await expect(page.getByRole('button', { name: '動画を選ぶ' })).toBeVisible();
  await expect(page.getByText('長い間を、短く。')).toBeVisible();
  await expect(page.getByText('対応条件')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 's0-start.png') });
  // セキュリティ: renderer に Node が無い
  const hasRequire = await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require !== 'undefined' || typeof (window as unknown as { process?: unknown }).process !== 'undefined');
  expect(hasRequire).toBe(false);
  const api = await page.evaluate(() => Object.keys((window as unknown as { maqiri: Record<string, unknown> }).maqiri).sort());
  expect(api).toEqual(['invoke', 'onEvent', 'platform']);
});

test('sample → analysis → edit screen shows candidates and waveform', async () => {
  await page.getByRole('button', { name: '10 秒の同梱サンプルを試す' }).click();
  await expect(page.getByRole('heading', { name: '仕上がりの間隔' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('img', { name: /波形/ })).toBeVisible();
  const countText = await page.getByText(/か所のカット候補/).textContent();
  const count = Number(/(\d+)/.exec(countText ?? '')?.[1] ?? '0');
  expect(count).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: path.join(artifacts, 's2-edit.png') });
});

test('keep / undo / redo and candidate list interactions', async () => {
  const list = page.getByRole('listbox', { name: 'カット候補一覧' });
  const firstKeep = list.getByRole('button', { name: /1 番の間を残す/ });
  await firstKeep.click();
  await expect(list.getByText('保持')).toBeVisible();
  await page.getByRole('button', { name: /元に戻す/ }).click();
  await expect(list.getByText('保持')).toHaveCount(0);
  await page.getByRole('button', { name: /やり直す/ }).click();
  await expect(list.getByText('保持')).toBeVisible();
  await page.getByRole('button', { name: /元に戻す/ }).click();
  await expect(list.getByText('保持')).toHaveCount(0);
});

test('junction preview renders original and edited clips', async () => {
  await page.getByRole('button', { name: 'つなぎ目を確認' }).first().click();
  await expect(page.getByRole('button', { name: '編集後' })).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('video[aria-label="編集後のつなぎ目"]')).toHaveAttribute('src', /maqiri-media:\/\/cache\//);
});

test('export writes an MP4 to the fixed destination and shows the done screen', async () => {
  await page.getByRole('button', { name: '動画を書き出す' }).click();
  await expect(page.getByRole('dialog', { name: '書き出し' })).toBeVisible();
  await page.getByRole('button', { name: '保存先を選ぶ…' }).click();
  await expect(page.getByText(/sample_10s_maqiri\.mp4/)).toBeVisible();
  const dialog = page.getByRole('dialog', { name: '書き出し' });
  const unreviewed = dialog.getByRole('checkbox');
  if (await unreviewed.count()) await unreviewed.first().check();
  await page.getByRole('dialog', { name: '書き出し' }).getByRole('button', { name: /この設定で保存|未確認を含めて保存/ }).click();
  await expect(page.getByRole('heading', { name: '書き出しが完了しました' })).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: path.join(artifacts, 's4-done.png') });
  const files = readdirSync(exportDir).filter((f) => f.endsWith('.mp4'));
  expect(files).toContain('sample_10s_maqiri.mp4');
  expect(statSync(path.join(exportDir, 'sample_10s_maqiri.mp4')).size).toBeGreaterThan(10_000);
  // 一時ファイルが残っていない
  expect(readdirSync(exportDir).some((f) => f.includes('maqiri-tmp'))).toBe(false);
});

test('project autosaved and listed in recent after returning to start', async () => {
  await page.getByRole('button', { name: '別の動画を選ぶ' }).click();
  await expect(page.getByRole('heading', { name: '最近のプロジェクト' })).toBeVisible();
  const projects = path.join(userData, 'projects');
  expect(existsSync(projects)).toBe(true);
  expect(readdirSync(projects).some((f) => f.endsWith('.maqiri.json'))).toBe(true);
});

test('layout holds at 960×700, 1280×800, 1440×900 and 200% zoom without horizontal page scroll', async () => {
  // 開始画面(S0)で確認。編集画面は前のテストで S0 へ戻っている。
  for (const [w, h] of [
    [960, 700],
    [1280, 800],
    [1440, 900]
  ] as const) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size[0], size[1]), [w, h] as [number, number]);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${w}x${h}`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(artifacts, `s0-${w}x${h}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2));
  await page.waitForTimeout(300);
  const overflowZoom = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflowZoom).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(artifacts, 's0-zoom200.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
});

test('keyboard: Tab reaches the primary action and focus ring is visible', async () => {
  await page.keyboard.press('Tab');
  const active = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '');
  expect(active.length).toBeGreaterThan(0);
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle);
  expect(outline).not.toBe('none');
});

test('AC04: a kept range survives reopening the project from the recent list', async () => {
  // 最近の一覧から開く → 編集画面
  await page.locator('.recent-row').first().click();
  await expect(page.getByRole('heading', { name: '仕上がりの間隔' })).toBeVisible({ timeout: 120_000 });
  const list = page.getByRole('listbox', { name: 'カット候補一覧' });
  await list.getByRole('button', { name: /1 番の間を残す/ }).click();
  await expect(list.getByText('保持')).toBeVisible();
  // 自動保存(1000ms debounce)を待ってから開始画面へ
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Maqiri 開始画面へ' }).click();
  await expect(page.getByRole('heading', { name: '最近のプロジェクト' })).toBeVisible();
  await page.locator('.recent-row').first().click();
  await expect(page.getByRole('heading', { name: '仕上がりの間隔' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('listbox', { name: 'カット候補一覧' }).getByText('保持')).toBeVisible();
  // 再解析(プリセット変更)後も保持はフレーム区間として残る
  await page.getByRole('radio', { name: 'ゆったり' }).click();
  await expect(page.getByRole('listbox', { name: 'カット候補一覧' }).getByText(/保持/)).toBeVisible();
});
