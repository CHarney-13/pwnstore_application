import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('exposes the sandboxed bridge and confines focus to the confidence dialog', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'pwnstore-e2e-'));
  let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    electronApp = await electron.launch({
      args: [path.resolve('dist', 'main', 'main.cjs'), `--user-data-dir=${temporaryDirectory}`],
      cwd: temporaryDirectory,
      env: { ...process.env, SECGEN_DIR: path.join(temporaryDirectory, 'secgen'), VITE_DEV_SERVER_URL: '' },
    });
    const page = await electronApp.firstWindow();
    await expect(page.getByRole('button', { name: 'PWNShop' })).toBeVisible();
    expect(await page.evaluate(() => typeof window.pwnshopApi?.listScenarios)).toBe('function');
    await expect(page.getByRole('button', { name: /Launch Lab:/ }).first()).toBeVisible();
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('pwnshop:launch-scenario');
      ipcMain.handle('pwnshop:launch-scenario', (_event, scenarioId: string) => ({
        ok: true, data: { scenarioId, host: '127.0.0.1', port: 18081, url: 'http://127.0.0.1:18081' },
      }));
      ipcMain.removeHandler('pwnshop:submit-flag');
      ipcMain.handle('pwnshop:submit-flag', () => ({ ok: true, data: { correct: true } }));
      ipcMain.removeHandler('pwnshop:save-confidence-rating');
      ipcMain.handle('pwnshop:save-confidence-rating', () => ({ ok: true }));
    });
    await page.getByRole('button', { name: /Launch Lab:/ }).first().click();
    await page.getByLabel('Submit flag').fill('test');
    const submit = page.getByRole('button', { name: 'Submit Flag' });
    await submit.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: '1' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await dialog.getByRole('radio', { name: '4' }).click();
    await dialog.getByRole('button', { name: 'Save & Continue' }).click();
    await expect(dialog).toBeHidden();
    await expect(submit).toBeFocused();
  } finally {
    if (electronApp) await electronApp.close();
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  }
});
