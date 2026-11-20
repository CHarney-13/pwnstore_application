import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, type PwnshopApi } from '../../src/shared/ipcTypes';

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
    await api.getLabLogs('s');
    await api.saveConfidenceRating('s', 3);
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.getSystemHealth],
      [IPC_CHANNELS.listScenarios],
      [IPC_CHANNELS.launchScenario, 's'],
      [IPC_CHANNELS.stopScenario, 's'],
      [IPC_CHANNELS.submitFlag, 's', 'f'],
      [IPC_CHANNELS.askAiHelper, { scenarioId: 's', question: 'q' }],
      [IPC_CHANNELS.getLabLogs, 's'],
      [IPC_CHANNELS.saveConfidenceRating, 's', 3],
    ]);
    await expect(api.launchScenario('s')).resolves.toBe('result');
  });

  it('throws when the main process reports an error', async () => {
    invoke.mockResolvedValue({ ok: false, error: 'boom' });
    const api = await loadApi();
    await expect(api.stopScenario('s')).rejects.toThrow('boom');
  });
});
