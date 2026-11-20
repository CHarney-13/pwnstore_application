import React, { useLayoutEffect, useRef, useState } from 'react';

interface ConfidenceModalProps {
  onSave: (rating: number) => Promise<void> | void;
}

export function ConfidenceModal({ onSave }: ConfidenceModalProps): React.JSX.Element {
  const [rating, setRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstRatingRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    firstRatingRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  async function save(): Promise<void> {
    if (rating === null) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(rating);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="confidence-title"
      onCancel={(event) => event.preventDefault()}
      className="w-[calc(100%-2rem)] max-w-md space-y-4 rounded-2xl bg-surface-white p-6 shadow-xl backdrop:bg-ink-primary/40"
    >
      <p className="eyebrow">Flag captured</p>
      <h2 id="confidence-title" className="text-xl font-bold">
        How confident do you feel with this exploit?
      </h2>
      <div role="radiogroup" aria-labelledby="confidence-title" className="flex justify-between gap-2">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            ref={value === 1 ? firstRatingRef : undefined}
            type="button"
            role="radio"
            aria-checked={rating === value}
            onClick={() => setRating(value)}
            className={`h-12 w-12 rounded-full text-lg font-bold transition-colors ${
              rating === value
                ? 'bg-brand-purple text-white'
                : 'bg-brand-lavender text-brand-lavender-text hover:bg-brand-lavender/70'
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-ink-muted">
        <span>Not confident</span>
        <span>Very confident</span>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="button" className="btn-primary w-full" disabled={rating === null || saving} onClick={() => void save()}>
        Save &amp; Continue
      </button>
    </dialog>
  );
}
