import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type IpcResponse,
  type PwnshopApi,
} from './shared/ipcTypes';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = (await ipcRenderer.invoke(channel, ...args)) as IpcResponse<T>;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

const api: PwnshopApi = {
  getSystemHealth: () => invoke(IPC_CHANNELS.getSystemHealth),
  listScenarios: () => invoke(IPC_CHANNELS.listScenarios),
  launchScenario: (scenarioId) => invoke(IPC_CHANNELS.launchScenario, scenarioId),
  stopScenario: (scenarioId) => invoke(IPC_CHANNELS.stopScenario, scenarioId),
  submitFlag: (scenarioId, flag) => invoke(IPC_CHANNELS.submitFlag, scenarioId, flag),
  askAiHelper: (payload) => invoke(IPC_CHANNELS.askAiHelper, payload),
  getLabLogs: (scenarioId) => invoke(IPC_CHANNELS.getLabLogs, scenarioId),
  saveConfidenceRating: (scenarioId, rating) =>
    invoke(IPC_CHANNELS.saveConfidenceRating, scenarioId, rating),
};

contextBridge.exposeInMainWorld('pwnshopApi', api);
