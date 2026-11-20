import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIpcHandlers } from '../../src/main/ipcHandlers';
import { SCENARIO_CATALOG } from '../../src/main/scenarioCatalog';
import { ProgressService } from '../../src/main/services/progressService';
import { IPC_CHANNELS, type IpcResponse } from '../../src/shared/ipcTypes';

type Handler = (event: unknown, ...args: unknown[]) => Promise<IpcResponse<any>>;

const first = SCENARIO_CATALOG[1];
const id = first.context.id;

describe('registerIpcHandlers', () => {
  let tmp: string;
  let handlers: Map<string, Handler>;
  let secgen: any;
  let llm: any;
  let demoLab: any;
  let progress: ProgressService;

  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'pwnshop-'));
    handlers = new Map();
    secgen = {
      restoreProject: vi.fn().mockResolvedValue(null),
      generateScenario: vi.fn().mockResolvedValue({}),
      startTargetLab: vi.fn().mockResolvedValue(undefined),
      stopTargetLab: vi.fn().mockResolvedValue(undefined),
      verifyFlag: vi.fn().mockReturnValue(false),
    };
    llm = {
      checkHealth: vi.fn().mockResolvedValue({ dockerConnected: true, llmRunning: true }),
      queryAiHelper: vi.fn().mockResolvedValue('hint'),
    };
    demoLab = {
      restore: vi.fn().mockResolvedValue(null),
      start: vi.fn().mockResolvedValue(49152),
      stop: vi.fn().mockResolvedValue(undefined),
      verifyFlag: vi.fn().mockImplementation((flag: string) => flag.trim() === 'PWNSHOP{demo_sqli_mastered_2026}'),
      getRecentLogs: vi.fn().mockReturnValue(['POST /login rejected']),
    };
    progress = new ProgressService(path.join(tmp, 'progress.json'));
    registerIpcHandlers(
      { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } } as any,
      { secgen, demoLab, llm, progress, catalog: SCENARIO_CATALOG, scenariosDirectory: path.join(tmp, 'scn') },
    );
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('registers every channel', () => {
    expect([...handlers.keys()].sort()).toEqual(Object.values(IPC_CHANNELS).sort());
  });

  it('getSystemHealth maps llm health', async () => {
    expect(await call(IPC_CHANNELS.getSystemHealth)).toEqual({
      ok: true, data: { dockerConnected: true, localAiReady: true, runnerRunning: undefined, modelAvailable: undefined, error: undefined },
    });
  });

  it('listScenarios returns the catalog with progress', async () => {
    const res = await call(IPC_CHANNELS.listScenarios);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.scenarios).toHaveLength(SCENARIO_CATALOG.length);
    expect(res.data.lastScenarioId).toBeNull();
    expect(res.data.scenarios[0]).toMatchObject({ id: 'demo-sqli-01', difficulty: 'Beginner', topic: 'SQL injection' });
  });

  it('launches the demo, locks other labs, verifies flags and supplies logs to the AI', async () => {
    const demoId = 'demo-sqli-01';
    expect(await call(IPC_CHANNELS.launchScenario, demoId)).toEqual({
      ok: true, data: { scenarioId: demoId, host: '127.0.0.1', port: 49152, url: 'http://127.0.0.1:49152' },
    });
    expect(secgen.generateScenario).not.toHaveBeenCalled();
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(false);
    expect(await call(IPC_CHANNELS.getLabLogs, demoId)).toEqual({ ok: true, data: ['POST /login rejected'] });
    expect(await call(IPC_CHANNELS.submitFlag, demoId, 'wrong')).toEqual({ ok: true, data: { correct: false } });
    expect(await call(IPC_CHANNELS.submitFlag, demoId, 'PWNSHOP{demo_sqli_mastered_2026}')).toEqual({ ok: true, data: { correct: true } });
    await call(IPC_CHANNELS.askAiHelper, { scenarioId: demoId, question: 'Why?', recentLogs: [] });
    expect(llm.queryAiHelper).toHaveBeenCalledWith('Why?', SCENARIO_CATALOG[0].context, ['POST /login rejected']);
    expect(await call(IPC_CHANNELS.stopScenario, demoId)).toEqual({ ok: true, data: undefined });
    expect(demoLab.stop).toHaveBeenCalledOnce();
    expect((await call(IPC_CHANNELS.getLabLogs, demoId)).ok).toBe(false);
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(true);
  });

  it('recovers and cleans up both retained labs one at a time', async () => {
    secgen.restoreProject.mockResolvedValue(id);
    demoLab.restore.mockResolvedValue('demo-sqli-01');
    registerIpcHandlers(
      { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } } as any,
      { secgen, demoLab, llm, progress, catalog: SCENARIO_CATALOG, scenariosDirectory: tmp },
    );
    expect(await call(IPC_CHANNELS.listScenarios)).toMatchObject({ ok: true, data: { cleanupScenarioId: id } });
    expect((await call(IPC_CHANNELS.stopScenario, id)).ok).toBe(true);
    expect(await call(IPC_CHANNELS.listScenarios)).toMatchObject({ ok: true, data: { cleanupScenarioId: 'demo-sqli-01' } });
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(false);
    expect((await call(IPC_CHANNELS.stopScenario, 'demo-sqli-01')).ok).toBe(true);
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(true);
  });

  it('launchScenario generates, starts, and returns a loopback URL', async () => {
    const res = await call(IPC_CHANNELS.launchScenario, id);
    expect(secgen.generateScenario).toHaveBeenCalledWith(path.join(tmp, 'scn', first.scenarioFile), id);
    expect(secgen.startTargetLab).toHaveBeenCalled();
    expect(res).toEqual({
      ok: true,
      data: { scenarioId: id, host: '127.0.0.1', port: first.hostPort, url: `http://127.0.0.1:${first.hostPort}` },
    });
    expect(progress.getLastScenarioId()).toBe(id);
  });

  it('rejects a second lab until the first is stopped', async () => {
    await call(IPC_CHANNELS.launchScenario, id);
    expect((await call(IPC_CHANNELS.launchScenario, SCENARIO_CATALOG[2].context.id)).ok).toBe(false);
    await call(IPC_CHANNELS.stopScenario, id);
    expect((await call(IPC_CHANNELS.launchScenario, SCENARIO_CATALOG[2].context.id)).ok).toBe(true);
    expect(secgen.stopTargetLab).toHaveBeenCalledTimes(1);
  });

  it('rejects concurrent launches while generation is pending', async () => {
    let finish!: () => void;
    secgen.generateScenario.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const firstLaunch = call(IPC_CHANNELS.launchScenario, id);
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(false);
    expect(secgen.generateScenario).toHaveBeenCalledTimes(1);
    finish();
    expect((await firstLaunch).ok).toBe(true);
  });

  it('cleans failed provisioning and permits a later launch', async () => {
    secgen.startTargetLab.mockRejectedValueOnce(new Error('provision failed'));
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(false);
    expect(secgen.stopTargetLab).toHaveBeenCalledTimes(1);
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(true);
  });

  it('cleans a partially generated project when generation fails', async () => {
    secgen.generateScenario.mockRejectedValueOnce(new Error('generation failed'));
    expect(await call(IPC_CHANNELS.launchScenario, id)).toMatchObject({ ok: false, error: 'generation failed' });
    expect(secgen.stopTargetLab).toHaveBeenCalledOnce();
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(true);
  });

  it('retains the failed project until cleanup can be retried', async () => {
    secgen.startTargetLab.mockRejectedValueOnce(new Error('provision failed'));
    secgen.stopTargetLab.mockRejectedValueOnce(new Error('destroy failed'));
    expect(await call(IPC_CHANNELS.launchScenario, id)).toMatchObject({ ok: false, error: expect.stringContaining('Cleanup failed') });
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(false);
    expect(secgen.generateScenario).toHaveBeenCalledTimes(1);
    const catalog = await call(IPC_CHANNELS.listScenarios);
    expect(catalog.ok && catalog.data.cleanupScenarioId).toBe(id);
    expect((await call(IPC_CHANNELS.stopScenario, id)).ok).toBe(true);
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(true);
  });

  it('blocks launches and permits cleanup of a project restored after restart', async () => {
    secgen.restoreProject.mockResolvedValue(id);
    registerIpcHandlers(
      { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } } as any,
      { secgen, demoLab, llm, progress, catalog: SCENARIO_CATALOG, scenariosDirectory: tmp },
    );
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(false);
    expect(secgen.generateScenario).not.toHaveBeenCalled();
    expect((await call(IPC_CHANNELS.stopScenario, id)).ok).toBe(true);
    expect((await call(IPC_CHANNELS.launchScenario, id)).ok).toBe(true);
  });

  it('returns errors instead of throwing', async () => {
    secgen.startTargetLab.mockRejectedValue(new Error('vagrant failed'));
    expect(await call(IPC_CHANNELS.launchScenario, id)).toEqual({ ok: false, error: 'vagrant failed' });
    expect(await call(IPC_CHANNELS.launchScenario, 'nope')).toEqual({ ok: false, error: 'Unknown scenario: nope' });
    expect((await call(IPC_CHANNELS.launchScenario, 42)).ok).toBe(false);
  });

  it('stopScenario stops only the active lab', async () => {
    expect((await call(IPC_CHANNELS.stopScenario, id)).ok).toBe(false);
    await call(IPC_CHANNELS.launchScenario, id);
    expect(await call(IPC_CHANNELS.stopScenario, id)).toEqual({ ok: true, data: undefined });
    expect(secgen.stopTargetLab).toHaveBeenCalledTimes(1);
  });

  it('submitFlag verifies via secgen and records progress', async () => {
    expect((await call(IPC_CHANNELS.submitFlag, id, 'x')).ok).toBe(false);
    await call(IPC_CHANNELS.launchScenario, id);
    expect(await call(IPC_CHANNELS.submitFlag, id, 'bad')).toEqual({ ok: true, data: { correct: false } });
    secgen.verifyFlag.mockReturnValue(true);
    expect(await call(IPC_CHANNELS.submitFlag, id, ' good ')).toEqual({ ok: true, data: { correct: true } });
    expect(secgen.verifyFlag).toHaveBeenLastCalledWith(' good ');
    const summary = progress.summary(() => undefined);
    expect(summary).toMatchObject({ completedActivities: 1, totalAttempts: 2 });
    expect((await call(IPC_CHANNELS.submitFlag, id, '')).ok).toBe(false);
    expect((await call(IPC_CHANNELS.submitFlag, id, 'a'.repeat(600))).ok).toBe(false);
  });

  it('askAiHelper checks health on every request and passes scenario context without flags', async () => {
    const payload = { scenarioId: id, question: 'help?', recentLogs: ['a', 5, 'b'] };
    expect(await call(IPC_CHANNELS.askAiHelper, payload)).toEqual({ ok: true, data: { answer: 'hint' } });
    await call(IPC_CHANNELS.askAiHelper, payload);
    expect(llm.checkHealth).toHaveBeenCalledTimes(2);
    expect(llm.queryAiHelper).toHaveBeenCalledWith('help?', first.context, ['a', 'b']);
  });

  it('runs background health checks every five minutes', async () => {
    vi.useFakeTimers();
    try {
      const localLlm = { ...llm, checkHealth: vi.fn().mockResolvedValue({ dockerConnected: true, llmRunning: true }) };
      registerIpcHandlers({ handle: vi.fn() } as any, { secgen, demoLab, llm: localLlm, progress, catalog: SCENARIO_CATALOG, scenariosDirectory: tmp });
      await vi.advanceTimersByTimeAsync(299_999);
      expect(localLlm.checkHealth).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(localLlm.checkHealth).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(localLlm.checkHealth).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('askAiHelper surfaces LLM errors and rejects bad payloads', async () => {
    llm.queryAiHelper.mockRejectedValue(new Error('llm down'));
    expect(await call(IPC_CHANNELS.askAiHelper, { scenarioId: id, question: 'q' })).toEqual({ ok: false, error: 'llm down' });
    expect((await call(IPC_CHANNELS.askAiHelper, null)).ok).toBe(false);
    expect((await call(IPC_CHANNELS.askAiHelper, { scenarioId: id, question: '  ' })).ok).toBe(false);
  });

  it('refuses AI requests if the on-demand check fails', async () => {
    llm.checkHealth.mockResolvedValueOnce({ dockerConnected: true, llmRunning: false, modelAvailable: false, error: 'model missing' });
    expect(await call(IPC_CHANNELS.askAiHelper, { scenarioId: id, question: 'help' })).toEqual({ ok: false, error: 'model missing' });
    expect(llm.queryAiHelper).not.toHaveBeenCalled();
  });

  it('saveConfidenceRating validates and persists 1-5', async () => {
    expect(await call(IPC_CHANNELS.saveConfidenceRating, id, 4)).toEqual({ ok: true, data: undefined });
    expect(progress.getRating(id)).toBe(4);
    expect((await call(IPC_CHANNELS.saveConfidenceRating, id, 6)).ok).toBe(false);
    expect((await call(IPC_CHANNELS.saveConfidenceRating, id, 2.5)).ok).toBe(false);
    expect((await call(IPC_CHANNELS.saveConfidenceRating, id, '3')).ok).toBe(false);
  });
});
