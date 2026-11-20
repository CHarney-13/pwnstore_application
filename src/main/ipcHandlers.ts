import path from 'node:path';
import type { IpcMain } from 'electron';
import {
  IPC_CHANNELS,
  type AiHelperPayload,
  type AiHelperResult,
  type FlagResult,
  type IpcResponse,
  type LaunchResult,
  type ListScenariosResult,
  type SystemHealth,
} from '../shared/ipcTypes';
import type { CatalogEntry } from './scenarioCatalog';
import type { DockerLlmService } from './services/dockerLlmService';
import type { ProgressService } from './services/progressService';
import type { SecGenService } from './services/secgenService';

const LOOPBACK = '127.0.0.1';
const MAX_FLAG_LENGTH = 512;
const MAX_QUESTION_LENGTH = 2_000;
const MAX_LOG_LINES = 10;

export interface IpcHandlerDependencies {
  secgen: Pick<SecGenService, 'restoreProject' | 'generateScenario' | 'startTargetLab' | 'stopTargetLab' | 'verifyFlag'>;
  llm: Pick<DockerLlmService, 'checkHealth' | 'queryAiHelper'>;
  progress: ProgressService;
  catalog: CatalogEntry[];
  scenariosDirectory: string;
}

function requireString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  if (value.length > maxLength) throw new Error(`${name} is too long.`);
  return value;
}

export function registerIpcHandlers(ipcMain: Pick<IpcMain, 'handle'>, deps: IpcHandlerDependencies): void {
  let activeScenarioId: string | null = null;
  let labBusy = false;
  let labReady = false;
  const recovery = deps.secgen.restoreProject().then(
    (id) => { activeScenarioId = id; return { ok: true as const }; },
    (error: unknown) => ({ ok: false as const, error }),
  );
  const awaitRecovery = async (): Promise<void> => {
    const result = await recovery;
    if (!result.ok) throw result.error;
  };

  const checkHealth = async (): Promise<SystemHealth> => {
    const health = await deps.llm.checkHealth();
    return {
      dockerConnected: health.dockerConnected,
      localAiReady: health.llmRunning,
      runnerRunning: health.runnerRunning,
      modelAvailable: health.modelAvailable,
      error: health.error,
    };
  };
  const timer = setInterval(() => {
    void checkHealth().catch((error: unknown) => console.error('Model Runner health check failed:', error));
  }, 5 * 60 * 1000);
  timer.unref();

  const findEntry = (id: unknown): CatalogEntry => {
    const scenarioId = requireString(id, 'scenarioId', 128);
    const found = deps.catalog.find((candidate) => candidate.context.id === scenarioId);
    if (!found) throw new Error(`Unknown scenario: ${scenarioId}`);
    return found;
  };

  const register = <T>(channel: string, handler: (...args: unknown[]) => Promise<T> | T): void => {
    ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResponse<T>> => {
      try {
        return { ok: true, data: await handler(...args) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  };

  register<SystemHealth>(IPC_CHANNELS.getSystemHealth, async () => {
    return checkHealth();
  });

  register<ListScenariosResult>(IPC_CHANNELS.listScenarios, async () => {
    await awaitRecovery();
    return {
      scenarios: deps.catalog.map((item) => ({
        id: item.context.id,
        title: item.title,
        difficulty: item.difficulty,
        topic: item.topic,
        briefing: item.briefing,
        lastConfidence: deps.progress.getRating(item.context.id),
      })),
      progress: deps.progress.summary(
        (id) => deps.catalog.find((item) => item.context.id === id)?.topic,
      ),
      lastScenarioId: deps.progress.getLastScenarioId(),
      cleanupScenarioId: !labReady && !labBusy ? activeScenarioId : null,
    };
  });

  register<LaunchResult>(IPC_CHANNELS.launchScenario, async (id) => {
    const entry = findEntry(id);
    await awaitRecovery();
    if (labBusy || activeScenarioId) throw new Error('A lab is already running, launching, or awaiting cleanup. Stop it before launching another.');
    labBusy = true;
    activeScenarioId = entry.context.id;
    try {
      await deps.secgen.generateScenario(path.join(deps.scenariosDirectory, entry.scenarioFile), entry.context.id);
      await deps.secgen.startTargetLab();
      labReady = true;
      deps.progress.markStarted(entry.context.id);
      return {
        scenarioId: entry.context.id,
        host: LOOPBACK,
        port: entry.hostPort,
        url: `http://${LOOPBACK}:${entry.hostPort}`,
      };
    } catch (error) {
      try {
        await deps.secgen.stopTargetLab();
        activeScenarioId = null;
        labReady = false;
      } catch (cleanupError) {
        labReady = false;
        throw new Error(`Lab launch failed: ${String(error)}. Cleanup failed: ${String(cleanupError)}. Retry cleanup before launching another lab.`);
      }
      throw error;
    } finally {
      labBusy = false;
    }
  });

  register<void>(IPC_CHANNELS.stopScenario, async (id) => {
    const scenarioId = requireString(id, 'scenarioId', 128);
    await awaitRecovery();
    if (labBusy) throw new Error('A lab operation is already in progress.');
    if (activeScenarioId !== scenarioId) throw new Error('That lab is not running.');
    labBusy = true;
    labReady = false;
    try {
      await deps.secgen.stopTargetLab();
      activeScenarioId = null;
      labReady = false;
    } finally {
      labBusy = false;
    }
  });

  register<FlagResult>(IPC_CHANNELS.submitFlag, (id, flag) => {
    const entry = findEntry(id);
    const submitted = requireString(flag, 'flag', MAX_FLAG_LENGTH);
    if (!labReady || activeScenarioId !== entry.context.id) throw new Error('Launch the lab before submitting a flag.');
    const correct = deps.secgen.verifyFlag(submitted);
    deps.progress.recordAttempt();
    if (correct) deps.progress.recordCompletion(entry.context.id);
    return { correct };
  });

  register<AiHelperResult>(IPC_CHANNELS.askAiHelper, async (rawPayload) => {
    const payload = (rawPayload ?? {}) as Partial<AiHelperPayload>;
    const entry = findEntry(payload.scenarioId);
    const question = requireString(payload.question, 'question', MAX_QUESTION_LENGTH);
    const logs = Array.isArray(payload.recentLogs)
      ? payload.recentLogs.filter((line): line is string => typeof line === 'string').slice(-MAX_LOG_LINES)
      : [];
    const health = await checkHealth();
    if (!health.localAiReady) throw new Error(health.error ?? 'Docker Model Runner is unavailable.');
    return { answer: await deps.llm.queryAiHelper(question, entry.context, logs) };
  });

  register<void>(IPC_CHANNELS.saveConfidenceRating, (id, rating) => {
    const entry = findEntry(id);
    if (typeof rating !== 'number') throw new Error('Confidence rating must be a number.');
    deps.progress.saveRating(entry.context.id, rating);
  });
}
