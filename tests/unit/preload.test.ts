import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, type PwnshopApi } from '../../src/shared/ipcTypes';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'vite';

const { expose, invoke } = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: expose },
  ipcRenderer: { invoke },
}));

async function loadApi(): Promise<PwnshopApi> {
  vi.resetModules();
  await import('../../src/preload');
  expect(expose).toHaveBeenCalledWith('pwnshopApi', expect.any(Object));
  return expose.mock.calls[0][1] as PwnshopApi;
}

describe('preload bridge', () => {
  beforeEach(() => invoke.mockResolvedValue({ ok: true, data: 'result' }));

  it('forwards each method to its channel and unwraps data', async () => {
    const api = await loadApi();
    await api.getSystemHealth();
    await api.listScenarios();
    await api.launchScenario('s');
    await api.stopScenario('s');
    await api.submitFlag('s', 'f');
    await api.askAiHelper({ scenarioId: 's', question: 'q' });
    await api.saveConfidenceRating('s', 3);
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.getSystemHealth],
      [IPC_CHANNELS.listScenarios],
      [IPC_CHANNELS.launchScenario, 's'],
      [IPC_CHANNELS.stopScenario, 's'],
      [IPC_CHANNELS.submitFlag, 's', 'f'],
      [IPC_CHANNELS.askAiHelper, { scenarioId: 's', question: 'q' }],
      [IPC_CHANNELS.saveConfidenceRating, 's', 3],
    ]);
    await expect(api.launchScenario('s')).resolves.toBe('result');
  });

  it('throws when the main process reports an error', async () => {
    invoke.mockResolvedValue({ ok: false, error: 'boom' });
    const api = await loadApi();
    await expect(api.stopScenario('s')).rejects.toThrow('boom');
  });

  it('builds a standalone sandbox-compatible preload exposing the IPC bridge', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'pwnstore-preload-'));
    try {
      await build({
        configFile: path.resolve('vite.main.config.ts'),
        mode: 'preload',
        logLevel: 'silent',
        build: { outDir },
      });
      const source = await readFile(path.join(outDir, 'preload.cjs'), 'utf8');
      const exposeInMainWorld = vi.fn();
      const invokeIpc = vi.fn().mockResolvedValue({ ok: true, data: 'ok' });
      vm.runInNewContext(source, {
        require: (id: string) => {
          if (id !== 'electron') throw new Error(`Sandbox cannot require ${id}`);
          return { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke: invokeIpc } };
        },
        exports: {},
        module: { exports: {} },
      });
      expect(exposeInMainWorld).toHaveBeenCalledWith('pwnshopApi', expect.any(Object));
      const api = exposeInMainWorld.mock.calls[0][1] as PwnshopApi;
      await expect(api.listScenarios()).resolves.toBe('ok');
      expect(invokeIpc).toHaveBeenCalledWith(IPC_CHANNELS.listScenarios);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
