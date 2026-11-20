import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProgressService } from '../../src/main/services/progressService';

describe('ProgressService', () => {
  let tmp: string;
  let file: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'pwnshop-prog-'));
    file = path.join(tmp, 'nested', 'progress.json');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('starts empty', () => {
    expect(new ProgressService(file).summary(() => undefined)).toEqual({
      completedActivities: 0, totalAttempts: 0, averageConfidence: null, lowConfidenceCategories: [],
    });
  });

  it('persists attempts, completions, ratings, and low-confidence topics', () => {
    const service = new ProgressService(file);
    service.recordAttempt();
    service.recordCompletion('a');
    service.recordCompletion('a');
    service.saveRating('a', 1);
    service.saveRating('b', 5);
    service.markStarted('b');

    const reloaded = new ProgressService(file);
    expect(reloaded.getRating('a')).toBe(1);
    expect(reloaded.getLastScenarioId()).toBe('b');
    expect(reloaded.summary((id) => (id === 'a' ? 'IDOR' : 'SQL injection'))).toEqual({
      completedActivities: 1, totalAttempts: 1, averageConfidence: 3, lowConfidenceCategories: ['IDOR'],
    });
  });

  it('rejects invalid ratings', () => {
    const service = new ProgressService(file);
    expect(() => service.saveRating('a', 0)).toThrow();
    expect(() => service.saveRating('a', 6)).toThrow();
  });
});
