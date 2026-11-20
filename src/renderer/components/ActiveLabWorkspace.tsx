import React, { useState } from 'react';
import type { LaunchResult, ScenarioSummary, SystemHealth } from '../../shared/ipcTypes';
import { ConfidenceModal } from './ConfidenceModal';

interface ActiveLabWorkspaceProps {
  scenario: ScenarioSummary;
  launch: LaunchResult;
  onExit: () => void;
  health: SystemHealth | null;
  onRefreshHealth: () => Promise<void>;
}

interface ChatMessage {
  role: 'student' | 'ai';
  text: string;
}

const QUICK_PROMPTS = ['Explain this vulnerability', 'Why did my last attempt fail?'];

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ActiveLabWorkspace({ scenario, launch, onExit, health, onRefreshHealth }: ActiveLabWorkspaceProps): React.JSX.Element {
  const api = window.pwnshopApi;
  const [flag, setFlag] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [logs, setLogs] = useState<string[]>([`Lab started at ${launch.url}`]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const addLog = (line: string): void => setLogs((prev) => [...prev, line]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!flag.trim()) return;
    try {
      const { correct } = await api.submitFlag(scenario.id, flag);
      addLog(`Flag attempt: ${correct ? 'accepted' : 'rejected'}`);
      if (correct) {
        setFeedback({ ok: true, text: 'Correct! Flag accepted.' });
        setShowModal(true);
      } else {
        setFeedback({ ok: false, text: 'That flag is not correct. Try again.' });
      }
    } catch (e) {
      setFeedback({ ok: false, text: errorMessage(e) });
    }
  }

  async function ask(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || asking || !health?.localAiReady) return;
    setMessages((prev) => [...prev, { role: 'student', text: trimmed }]);
    setQuestion('');
    setAsking(true);
    try {
      const { answer } = await api.askAiHelper({
        scenarioId: scenario.id,
        question: trimmed,
        recentLogs: logs.slice(-10),
      });
      setMessages((prev) => [...prev, { role: 'ai', text: answer }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'ai', text: `Sorry, the AI helper is unavailable: ${errorMessage(e)}` }]);
      await onRefreshHealth();
    } finally {
      setAsking(false);
    }
  }

  async function stop(): Promise<void> {
    try {
      await api.stopScenario(scenario.id);
      onExit();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function saveRating(rating: number): Promise<void> {
    await api.saveConfidenceRating(scenario.id, rating);
    setShowModal(false);
  }

  return (
    <div className="grid h-full gap-4 p-6 lg:grid-cols-2">
      <section className="flex min-h-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-lavender bg-surface-subtle p-3">
          <code className="flex-1 text-sm font-semibold text-ink-primary">{launch.url}</code>
          <button type="button" className="btn-secondary" onClick={() => void navigator.clipboard.writeText(launch.url)}>
            Copy URL
          </button>
          <button type="button" className="btn-secondary" onClick={() => window.open(launch.url, '_blank')}>
            Open in Browser
          </button>
          <button type="button" className="btn-primary" onClick={() => void stop()}>
            Stop Lab
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        <article className="space-y-2 rounded-2xl border border-brand-lavender bg-surface-white p-5">
          <p className="eyebrow">Active lab</p>
          <h1 className="text-xl font-bold">{scenario.title}</h1>
          <span className="pill">{scenario.topic}</span>
          <p className="text-sm text-ink-muted">{scenario.briefing}</p>
        </article>

        <form onSubmit={(e) => void submit(e)} className="space-y-2 rounded-2xl bg-surface-subtle p-5">
          <label htmlFor="flag-input" className="text-sm font-semibold">Submit flag</label>
          <div className="flex gap-2">
            <input
              id="flag-input"
              value={flag}
              onChange={(e) => setFlag(e.target.value)}
              autoComplete="off"
              className="flex-1 rounded-lg border border-ink-muted/30 px-3 py-2 text-sm"
            />
            <button type="submit" className="btn-primary">Submit Flag</button>
          </div>
          {feedback && (
            <p role="status" className={`text-sm font-semibold ${feedback.ok ? 'text-emerald-700' : 'text-red-700'}`}>
              {feedback.text}
            </p>
          )}
        </form>

        <div className="mt-auto overflow-hidden rounded-xl bg-[#14121a] font-mono text-xs text-green-300">
          <button
            type="button"
            aria-expanded={logsOpen}
            onClick={() => setLogsOpen((open) => !open)}
            className="w-full px-4 py-2 text-left font-semibold text-gray-200"
          >
            {logsOpen ? '▾' : '▸'} Container &amp; HTTP logs
          </button>
          {logsOpen && (
            <pre aria-label="Lab logs" className="max-h-40 overflow-auto px-4 pb-3 whitespace-pre-wrap">
              {logs.join('\n')}
            </pre>
          )}
        </div>
      </section>

      <section className="flex min-h-0 flex-col rounded-2xl border border-brand-lavender bg-surface-subtle p-5">
        <div className="flex items-center justify-between">
          <p className="eyebrow">AI diagnostic helper</p>
          <button type="button" className="btn-secondary" aria-label="Check AI helper availability" onClick={() => void onRefreshHealth()}>↻ Check AI</button>
        </div>
        {!health?.localAiReady && (
          <p role="status" className="mt-2 text-sm text-amber-800">
            {health?.error ?? 'No local AI model is currently available. Enable Docker Model Runner and install the required model.'}
          </p>
        )}
        <div className="my-3 flex-1 space-y-3 overflow-auto" aria-live="polite">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                m.role === 'student'
                  ? 'ml-auto bg-brand-lavender text-brand-lavender-text'
                  : 'border border-brand-lavender bg-surface-white text-ink-primary'
              }`}
            >
              {m.text}
            </div>
          ))}
          {asking && <p className="text-sm text-ink-muted">Thinking…</p>}
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" className="pill disabled:opacity-50" disabled={asking || !health?.localAiReady} onClick={() => void ask(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); void ask(question); }}
          className="flex gap-2"
        >
          <input
            aria-label="Ask the AI helper"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={asking || !health?.localAiReady}
            className="flex-1 rounded-lg border border-ink-muted/30 px-3 py-2 text-sm disabled:opacity-50"
          />
          <button type="submit" className="btn-primary" disabled={asking || !health?.localAiReady}>Send</button>
        </form>
      </section>

      {showModal && <ConfidenceModal onSave={saveRating} />}
    </div>
  

  )
}
