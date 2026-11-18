import React, { useEffect, useMemo, useState } from 'react';
import {
  VULNERABILITY_TOPICS,
  type LaunchResult,
  type ListScenariosResult,
  type ScenarioSummary,
} from '../../shared/ipcTypes';

interface LabCatalogProps {
  onLaunched: (scenario: ScenarioSummary, launch: LaunchResult) => void;
}

const FILTERS = ['All', ...VULNERABILITY_TOPICS] as const;

export function LabCatalog({ onLaunched }: LabCatalogProps): React.JSX.Element {
  const [data, setData] = useState<ListScenariosResult | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.pwnshopApi.listScenarios().then(
      (result) => { if (!cancelled) setData(result); },
      (e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(
    () => (data?.scenarios ?? []).filter((s) => filter === 'All' || s.topic === filter),
    [data, filter],
  );

  async function launch(scenario: ScenarioSummary): Promise<void> {
    setError(null);
    setLaunching(scenario.id);
    try {
      onLaunched(scenario, await window.pwnshopApi.launchScenario(scenario.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(null);
    }
  }

  const lastScenario = data?.scenarios.find((s) => s.id === data.lastScenarioId);
  const progress = data?.progress;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-brand-purple p-6 text-white">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-brand-lavender">
            Hands-on web security
          </p>
          <h1 className="mt-1 text-2xl font-extrabold">Your lab progress</h1>
          <p className="mt-1 text-sm text-brand-lavender">
            {progress
              ? `${progress.completedActivities} labs completed · ${progress.totalAttempts} flag attempts${
                  progress.averageConfidence === null
                    ? ''
                    : ` · avg confidence ${progress.averageConfidence.toFixed(1)}/5`
                }`
              : 'Loading progress…'}
          </p>
        </div>
        <button
          type="button"
          disabled={!lastScenario || launching !== null}
          onClick={() => lastScenario && void launch(lastScenario)}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-purple transition-colors hover:bg-brand-lavender disabled:opacity-50"
        >
          Resume Last Lab
        </button>
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}

      <div role="group" aria-label="Filter by vulnerability" className="flex flex-wrap gap-2">
        {FILTERS.map((topic) => (
          <button
            key={topic}
            type="button"
            aria-pressed={filter === topic}
            onClick={() => setFilter(topic)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              filter === topic
                ? 'bg-brand-purple text-white'
                : 'bg-brand-lavender text-brand-lavender-text hover:bg-brand-lavender/70'
            }`}
          >
            {topic}
          </button>
        ))}
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((scenario) => (
          <li
            key={scenario.id}
            className="flex flex-col gap-3 rounded-2xl border border-brand-lavender bg-surface-white p-5 shadow-sm"
          >
            <span className="pill self-start">{scenario.topic}</span>
            <h2 className="text-lg font-bold text-ink-primary">{scenario.title}</h2>
            <p className="text-sm text-ink-muted">Difficulty: {scenario.difficulty}</p>
            {scenario.lastConfidence !== null && (
              <p className="text-sm text-ink-muted">Last confidence: {scenario.lastConfidence}/5</p>
            )}
            <button
              type="button"
              className="btn-primary mt-auto"
              disabled={launching !== null}
              aria-label={`Launch Lab: ${scenario.title}`}
              onClick={() => void launch(scenario)}
            >
              Launch Lab
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
