import React, { useEffect, useState } from 'react';
import type { LaunchResult, ScenarioSummary, SystemHealth } from '../shared/ipcTypes';
import { ActiveLabWorkspace } from './components/ActiveLabWorkspace';
import { LabCatalog } from './components/LabCatalog';
import { TopBar } from './components/TopBar';

const HEALTH_POLL_MS = 5 * 60 * 1_000;

interface ActiveLab {
  scenario: ScenarioSummary;
  launch: LaunchResult;
}

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [active, setActive] = useState<ActiveLab | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const refreshHealth = async (): Promise<void> => {
    try {
      setHealth(await window.pwnshopApi.getSystemHealth());
    } catch (error) {
      setHealth({ dockerConnected: false, localAiReady: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      window.pwnshopApi.getSystemHealth().then(
        (result) => { if (!cancelled) setHealth(result); },
        (error: unknown) => {
          if (!cancelled) setHealth({
            dockerConnected: false,
            localAiReady: false,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
    };
    refresh();
    const timer = setInterval(refresh, HEALTH_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <TopBar health={health} onHome={() => setShowCatalog(true)} />
      {health?.error && !health.localAiReady && (
        <p role="status" className="bg-amber-50 px-6 py-2 text-sm text-amber-800">{health.error}</p>
      )}
      <main className="min-h-0 flex-1 overflow-auto bg-surface-white">
        {active && !showCatalog ? (
          <ActiveLabWorkspace
            scenario={active.scenario}
            launch={active.launch}
            health={health}
            onRefreshHealth={refreshHealth}
            onExit={() => { setActive(null); setShowCatalog(true); }}
          />
        ) : (
          <>
            {active && <button type="button" className="btn-secondary m-4" onClick={() => setShowCatalog(false)}>Return to running lab</button>}
            <LabCatalog onLaunched={(scenario, launch) => { setActive({ scenario, launch }); setShowCatalog(false); }} />
          </>
        )}
      </main>
    </div>
  );
}
