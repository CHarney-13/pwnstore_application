import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'node:path';

test('opens the desktop renderer', async () => {
  const electronApp = await electron.launch({
    args: [path.resolve('dist/main/main.cjs')],
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window.getByRole('heading', { name: 'Pwnstore' })).toBeVisible();
  } finally {
    await electronApp.close();
  }
});
