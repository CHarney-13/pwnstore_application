import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveLabWorkspace } from '../../src/renderer/components/ActiveLabWorkspace';
import { makeApi, scenarios } from './helpers';

const launch = { scenarioId: 'sqli-1', host: '127.0.0.1' as const, port: 18081, url: 'http://127.0.0.1:18081' };

function setup(onExit = vi.fn(), ready = true, onRefreshHealth = vi.fn().mockResolvedValue(undefined)) {
  render(<ActiveLabWorkspace scenario={scenarios[0]} launch={launch} onExit={onExit}
    health={{ dockerConnected: true, localAiReady: ready }} onRefreshHealth={onRefreshHealth} />);
  return { user: userEvent.setup(), onExit };
}

describe('ActiveLabWorkspace', () => {
  beforeEach(() => {
    window.pwnshopApi = makeApi();
  });

  it('shows target URL and briefing', () => {
    setup();
    expect(screen.getByText('http://127.0.0.1:18081')).toBeInTheDocument();
    expect(screen.getByText('Break the login.')).toBeInTheDocument();
  });

  it('shows error feedback for a wrong flag without opening the modal', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Submit flag'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Submit Flag' }));
    expect(window.pwnshopApi.submitFlag).toHaveBeenCalledWith('sqli-1', 'nope');
    expect(await screen.findByRole('status')).toHaveTextContent('not correct');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the confidence modal on a valid flag and saves the rating', async () => {
    window.pwnshopApi = makeApi({ submitFlag: vi.fn().mockResolvedValue({ correct: true }) });
    const { user } = setup();
    await user.type(screen.getByLabelText('Submit flag'), 'FLAG{x}');
    await user.click(screen.getByRole('button', { name: 'Submit Flag' }));
    expect(await screen.findByText('How confident do you feel with this exploit?')).toBeInTheDocument();

    const save = screen.getByRole('button', { name: /Save/ });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: '4' }));
    await user.click(save);
    expect(window.pwnshopApi.saveConfidenceRating).toHaveBeenCalledWith('sqli-1', 4);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('asks the AI helper via a quick-action chip and renders the answer', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Explain this vulnerability' }));
    expect(window.pwnshopApi.askAiHelper).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: 'sqli-1', question: 'Explain this vulnerability' }),
    );
    expect(await screen.findByText('Think about input handling.')).toBeInTheDocument();
  });

  it('shows a friendly message when the AI helper fails', async () => {
    window.pwnshopApi = makeApi({ askAiHelper: vi.fn().mockRejectedValue(new Error('offline')) });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Why did my last attempt fail?' }));
    expect(await screen.findByText(/AI helper is unavailable: offline/)).toBeInTheDocument();
  });

  it('disables AI controls when unavailable and permits an on-demand health check', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { user } = setup(vi.fn(), false, refresh);
    expect(screen.getByText(/No local AI model/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByLabelText('Ask the AI helper')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Explain this vulnerability' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Check AI helper availability' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('toggles the log drawer', async () => {
    const { user } = setup();
    expect(screen.queryByLabelText('Lab logs')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Container & HTTP logs/ }));
    expect(screen.getByLabelText('Lab logs')).toHaveTextContent('Lab started');
  });

  it('displays the live container logs in the drawer', async () => {
    window.pwnshopApi = makeApi({ getLabLogs: vi.fn().mockResolvedValue(['POST /login rejected']) });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Container & HTTP logs/ }));
    expect(await screen.findByText(/POST \/login rejected/)).toBeInTheDocument();
  });

  it('stops the lab and exits', async () => {
    const { user, onExit } = setup();
    await user.click(screen.getByRole('button', { name: 'Stop Lab' }));
    expect(window.pwnshopApi.stopScenario).toHaveBeenCalledWith('sqli-1');
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });

  it('copies the URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { user } = setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copy URL' }));
    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:18081');
  });
});
