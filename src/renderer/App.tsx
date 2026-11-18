import React, { useEffect, useState } from 'react';
import type { LaunchResult, ScenarioSummary, SystemHealth } from '../shared/ipcTypes';
import { ActiveLabWorkspace } from './components/ActiveLabWorkspace';
import { LabCatalog } from './components/LabCatalog';
import { TopBar } from './components/TopBar';

const HEALTH_POLL_MS = 5_000;

interface ActiveLab {
  scenario: ScenarioSummary;
  launch: LaunchResult;
}

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [active, setActive] = useState<ActiveLab | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      window.pwnshopApi.getSystemHealth().then(
        (result) => { if (!cancelled) setHealth(result); },
        () => { if (!cancelled) setHealth({ dockerConnected: false, localAiReady: false }); },
      );
    };
    refresh();
    const timer = setInterval(refresh, HEALTH_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <TopBar health={health} onHome={() => setActive(null)} />
      <main className="min-h-0 flex-1 overflow-auto bg-surface-white">
        {active ? (
          <ActiveLabWorkspace
            scenario={active.scenario}
            launch={active.launch}
            onExit={() => setActive(null)}
          />
        ) : (
          <LabCatalog onLaunched={(scenario, launch) => setActive({ scenario, launch })} />
        )}
      </main>
    </div>
  );
}
