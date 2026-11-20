import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerIpcHandlers } from './ipcHandlers';
import { isLoopbackLabUrl } from './externalLinks';
import { SCENARIO_CATALOG } from './scenarioCatalog';
import { DockerLlmService } from './services/dockerLlmService';
import { ProgressService } from './services/progressService';
import { SecGenService } from './services/secgenService';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Only loopback lab targets may be opened externally.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isLoopbackLabUrl(url)) {
      void shell.openExternal(url).catch((error: unknown) => console.error('Failed to open lab URL:', error));
    }
    return { action: 'deny' };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(currentDirectory, '../renderer/index.html'));
  }
  return window;
}

function setUpBackend(): void {
  const secgenDirectory = process.env.SECGEN_DIR ?? path.join(app.getPath('userData'), 'secgen');
  registerIpcHandlers(ipcMain, {
    secgen: new SecGenService({
      secgenDirectory,
      projectsDirectory: path.join(app.getPath('userData'), 'projects'),
    }),
    llm: new DockerLlmService(),
    progress: new ProgressService(path.join(app.getPath('userData'), 'progress.json')),
    catalog: SCENARIO_CATALOG,
    scenariosDirectory: process.env.PWNSHOP_SCENARIOS_DIR ?? path.join(secgenDirectory, 'scenarios', 'pwnshop'),
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(() => {
    setUpBackend();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
