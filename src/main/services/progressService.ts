import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { StudentProgress } from '../../shared/types';

interface ProgressData {
  attempts: number;
  completed: string[];
  ratings: Record<string, number>;
  lastScenarioId: string | null;
}

const LOW_CONFIDENCE_THRESHOLD = 2;

export class ProgressService {
  private data: ProgressData;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  getRating(scenarioId: string): number | null {
    return this.data.ratings[scenarioId] ?? null;
  }

  getLastScenarioId(): string | null {
    return this.data.lastScenarioId;
  }

  markStarted(scenarioId: string): void {
    this.data.lastScenarioId = scenarioId;
    this.save();
  }

  recordAttempt(): void {
    this.data.attempts += 1;
    this.save();
  }

  recordCompletion(scenarioId: string): void {
    if (!this.data.completed.includes(scenarioId)) this.data.completed.push(scenarioId);
    this.save();
  }

  saveRating(scenarioId: string, rating: number): void {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('Confidence rating must be a whole number from 1 to 5.');
    }
    this.data.ratings[scenarioId] = rating;
    this.save();
  }

  summary(categoryOf: (scenarioId: string) => string | undefined): StudentProgress {
    const ratings = Object.values(this.data.ratings);
    const low = Object.entries(this.data.ratings)
      .filter(([, rating]) => rating <= LOW_CONFIDENCE_THRESHOLD)
      .map(([id]) => categoryOf(id))
      .filter((category): category is string => Boolean(category));
    return {
      completedActivities: this.data.completed.length,
      totalAttempts: this.data.attempts,
      averageConfidence: ratings.length
        ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length
        : null,
      lowConfidenceCategories: [...new Set(low)],
    };
  }

  private load(): ProgressData {
    const empty: ProgressData = { attempts: 0, completed: [], ratings: {}, lastScenarioId: null };
    try {
      return { ...empty, ...(JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<ProgressData>) };
    } catch {
      return empty;
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }
}
