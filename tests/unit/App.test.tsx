import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { makeApi, scenarios } from './helpers';

describe('App', () => {
  beforeEach(() => {
    window.pwnshopApi = makeApi();
  });

  it('shows live health pills and the catalog', async () => {
    render(<App />);
    expect(await screen.findByText('Docker: Connected')).toBeInTheDocument();
    expect(screen.getByText('Local AI: Starting')).toBeInTheDocument();
    expect(await screen.findByText(scenarios[0].title)).toBeInTheDocument();
  });

  it('shows offline when health check fails', async () => {
    window.pwnshopApi = makeApi({ getSystemHealth: vi.fn().mockRejectedValue(new Error('x')) });
    render(<App />);
    expect(await screen.findByText('Docker: Offline')).toBeInTheDocument();
  });

  it('opens the workspace after launch and returns home via the wordmark', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Launch Lab: Login Bypass/ }));
    expect(await screen.findByText('http://127.0.0.1:18081')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'PWNShop' }));
    await waitFor(() => expect(screen.getByText('Resume Last Lab')).toBeInTheDocument());
  });
});
