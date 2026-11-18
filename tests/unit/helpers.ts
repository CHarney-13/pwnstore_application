import { vi } from 'vitest';
import type { PwnshopApi, ScenarioSummary } from '../../src/shared/ipcTypes';

export const scenarios: ScenarioSummary[] = [
  { id: 'sqli-1', title: 'Login Bypass', difficulty: 'Beginner', topic: 'SQL injection', briefing: 'Break the login.', lastConfidence: 4 },
  { id: 'idor-1', title: 'Order Viewer', difficulty: 'Beginner', topic: 'IDOR', briefing: 'View orders.', lastConfidence: null },
];

export function makeApi(overrides: Partial<PwnshopApi> = {}): PwnshopApi {
  return {
    getSystemHealth: vi.fn().mockResolvedValue({ dockerConnected: true, localAiReady: false }),
    listScenarios: vi.fn().mockResolvedValue({
      scenarios,
      progress: { completedActivities: 1, totalAttempts: 3, averageConfidence: 4, lowConfidenceCategories: [] },
      lastScenarioId: 'sqli-1',
    }),
    launchScenario: vi.fn().mockImplementation(async (scenarioId: string) => ({
      scenarioId, host: '127.0.0.1', port: 18081, url: 'http://127.0.0.1:18081',
    })),
    stopScenario: vi.fn().mockResolvedValue(undefined),
    submitFlag: vi.fn().mockResolvedValue({ correct: false }),
    askAiHelper: vi.fn().mockResolvedValue({ answer: 'Think about input handling.' }),
    saveConfidenceRating: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
