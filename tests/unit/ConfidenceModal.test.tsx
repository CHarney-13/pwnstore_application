import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfidenceModal } from '../../src/renderer/components/ConfidenceModal';

describe('ConfidenceModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens a native modal, focuses its controls, prevents escape dismissal and restores focus', async () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: showModal, configurable: true });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { value: close, configurable: true });
    const user = userEvent.setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<ConfidenceModal onSave={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.getByRole('radio', { name: '1' })).toHaveFocus();
    const cancel = new Event('cancel', { bubbles: false, cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('radio', { name: '4' }));
    unmount();
    await waitFor(() => expect(opener).toHaveFocus());
    expect(close).toHaveBeenCalledOnce();
    opener.remove();
  });
});
