import React from 'react';
import type { SystemHealth } from '../../shared/ipcTypes';

interface TopBarProps {
  health: SystemHealth | null;
  onHome: () => void;
}

function StatusPill({ label, ok }: { label: string; ok: boolean }): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
        ok ? 'bg-brand-lavender text-brand-lavender-text' : 'bg-amber-50 text-amber-800'
      }`}
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {label}
    </span>
  );
}

export function TopBar({ health, onHome }: TopBarProps): React.JSX.Element {
  return (
    <header className="flex items-center justify-between border-b border-brand-lavender bg-surface-white px-6 py-3">
      <button
        type="button"
        onClick={onHome}
        className="text-2xl font-extrabold tracking-tight text-brand-purple"
      >
        PWNShop
      </button>
      <div className="flex gap-2" aria-label="System status">
        <StatusPill
          ok={health?.dockerConnected ?? false}
          label={`Docker: ${health?.dockerConnected ? 'Connected' : 'Offline'}`}
        />
        <StatusPill
          ok={health?.localAiReady ?? false}
          label={`Local AI: ${health?.localAiReady ? 'Ready' : 'Starting'}`}
        />
      </div>
    </header>
  );
}
