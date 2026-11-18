import type { StudentProgress } from './types';

export const VULNERABILITY_TOPICS = [
  'SQL injection',
  'IDOR',
  'Cross-site scripting',
  'Broken access control',
  'OS command injection',
] as const;

export type VulnerabilityTopic = (typeof VULNERABILITY_TOPICS)[number];
export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export const IPC_CHANNELS = {
  getSystemHealth: 'pwnshop:get-system-health',
  listScenarios: 'pwnshop:list-scenarios',
  launchScenario: 'pwnshop:launch-scenario',
  stopScenario: 'pwnshop:stop-scenario',
  submitFlag: 'pwnshop:submit-flag',
  askAiHelper: 'pwnshop:ask-ai-helper',
  saveConfidenceRating: 'pwnshop:save-confidence-rating',
} as const;

export interface SystemHealth {
  dockerConnected: boolean;
  localAiReady: boolean;
}

export interface ScenarioSummary {
  id: string;
  title: string;
  difficulty: Difficulty;
  topic: VulnerabilityTopic;
  briefing: string;
  lastConfidence: number | null;
}

export interface ListScenariosResult {
  scenarios: ScenarioSummary[];
  progress: StudentProgress;
  lastScenarioId: string | null;
}

export interface LaunchResult {
  scenarioId: string;
  host: '127.0.0.1';
  port: number;
  url: string;
}

export interface FlagResult {
  correct: boolean;
}

export interface AiHelperPayload {
  scenarioId: string;
  question: string;
  recentLogs?: string[];
}

export interface AiHelperResult {
  answer: string;
}

export interface PwnshopApi {
  getSystemHealth(): Promise<SystemHealth>;
  listScenarios(): Promise<ListScenariosResult>;
  launchScenario(scenarioId: string): Promise<LaunchResult>;
  stopScenario(scenarioId: string): Promise<void>;
  submitFlag(scenarioId: string, flag: string): Promise<FlagResult>;
  askAiHelper(payload: AiHelperPayload): Promise<AiHelperResult>;
  saveConfidenceRating(scenarioId: string, rating: number): Promise<void>;
}

/** Envelope returned by every ipcMain handler so errors cross the bridge cleanly. */
export type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    pwnshopApi: PwnshopApi;
  }
}
