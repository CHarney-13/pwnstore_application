import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'node:path';

test('opens the desktop renderer', async () => {
  const electronApp = await electron.launch({
    args: [path.resolve('dist/main/main.cjs')],
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window.getByRole('button', { name: 'PWNShop' })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'Login Bypass' })).toBeVisible();
    await window.getByRole('button', { name: 'IDOR', exact: true }).click();
    await expect(window.getByRole('heading', { name: 'Order Viewer' })).toBeVisible();
    await expect(window.getByRole('heading', { name: 'Login Bypass' })).toHaveCount(0);
  } finally {
    await electronApp.close();
  }
});
