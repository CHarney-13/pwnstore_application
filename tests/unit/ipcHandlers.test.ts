import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIpcHandlers } from '../../src/main/ipcHandlers';
import { SCENARIO_CATALOG } from '../../src/main/scenarioCatalog';
import { ProgressService } from '../../src/main/services/progressService';
import { IPC_CHANNELS, type IpcResponse } from '../../src/shared/ipcTypes';

type Handler = (event: unknown, ...args: unknown[]) => Promise<IpcResponse<any>>;

const first = SCENARIO_CATALOG[0];
const id = first.context.id;

describe('registerIpcHandlers', () => {
  let tmp: string;
  let handlers: Map<string, Handler>;
  let secgen: any;
  let llm: any;
  let progress: ProgressService;

  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'pwnshop-'));
    handlers = new Map();
    secgen = {
      generateScenario: vi.fn().mockResolvedValue({}),
      startTargetLab: vi.fn().mockResolvedValue(undefined),
      stopTargetLab: vi.fn().mockResolvedValue(undefined),
      verifyFlag: vi.fn().mockReturnValue(false),
    };
    llm = {
      checkHealth: vi.fn().mockResolvedValue({ dockerConnected: true, llmRunning: true }),
      ensureLlmContainerRunning: vi.fn().mockResolvedValue({}),
      queryAiHelper: vi.fn().mockResolvedValue('hint'),
    };
    progress = new ProgressService(path.join(tmp, 'progress.json'));
    registerIpcHandlers(
      { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } } as any,
      { secgen, llm, progress, catalog: SCENARIO_CATALOG, scenariosDirectory: path.join(tmp, 'scn') },
    );
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('registers every channel', () => {
    expect([...handlers.keys()].sort()).toEqual(Object.values(IPC_CHANNELS).sort());
  });

  it('getSystemHealth maps llm health', async () => {
    expect(await call(IPC_CHANNELS.getSystemHealth)).toEqual({
      ok: true, data: { dockerConnected: true, localAiReady: true },
    });
  });

  it('listScenarios returns the catalog with progress', async () => {
    const res = await call(IPC_CHANNELS.listScenarios);
    if (!res.ok) throw new Error(res.error);
    expect(res.data.scenarios).toHaveLength(SCENARIO_CATALOG.length);
    expect(res.data.lastScenarioId).toBeNull();
  });

  it('launchScenario generates, starts, and returns a loopback URL', async () => {
    const res = await call(IPC_CHANNELS.launchScenario, id);
    expect(secgen.generateScenario).toHaveBeenCalledWith(path.join(tmp, 'scn', first.scenarioFile));
    expect(secgen.startTargetLab).toHaveBeenCalled();
    expect(res).toEqual({
      ok: true,
      data: { scenarioId: id, host: '127.0.0.1', port: first.hostPort, url: `http://127.0.0.1:${first.hostPort}` },
    });
    expect(progress.getLastScenarioId()).toBe(id);
  });

  it('launchScenario stops a previously running lab first', async () => {
    await call(IPC_CHANNELS.launchScenario, id);
    await call(IPC_CHANNELS.launchScenario, SCENARIO_CATALOG[1].context.id);
    expect(secgen.stopTargetLab).toHaveBeenCalledTimes(1);
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

  it('askAiHelper ensures the LLM once and passes scenario context without flags', async () => {
    const payload = { scenarioId: id, question: 'help?', recentLogs: ['a', 5, 'b'] };
    expect(await call(IPC_CHANNELS.askAiHelper, payload)).toEqual({ ok: true, data: { answer: 'hint' } });
    await call(IPC_CHANNELS.askAiHelper, payload);
    expect(llm.ensureLlmContainerRunning).toHaveBeenCalledTimes(1);
    expect(llm.queryAiHelper).toHaveBeenCalledWith('help?', first.context, ['a', 'b']);
  });

  it('askAiHelper surfaces LLM errors and rejects bad payloads', async () => {
    llm.queryAiHelper.mockRejectedValue(new Error('llm down'));
    expect(await call(IPC_CHANNELS.askAiHelper, { scenarioId: id, question: 'q' })).toEqual({ ok: false, error: 'llm down' });
    expect((await call(IPC_CHANNELS.askAiHelper, null)).ok).toBe(false);
    expect((await call(IPC_CHANNELS.askAiHelper, { scenarioId: id, question: '  ' })).ok).toBe(false);
  });

  it('saveConfidenceRating validates and persists 1-5', async () => {
    expect(await call(IPC_CHANNELS.saveConfidenceRating, id, 4)).toEqual({ ok: true, data: undefined });
    expect(progress.getRating(id)).toBe(4);
    expect((await call(IPC_CHANNELS.saveConfidenceRating, id, 6)).ok).toBe(false);
    expect((await call(IPC_CHANNELS.saveConfidenceRating, id, 2.5)).ok).toBe(false);
    expect((await call(IPC_CHANNELS.saveConfidenceRating, id, '3')).ok).toBe(false);
  });
});
