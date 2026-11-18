import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LabCatalog } from '../../src/renderer/components/LabCatalog';
import { makeApi, scenarios } from './helpers';

describe('LabCatalog', () => {
  beforeEach(() => {
    window.pwnshopApi = makeApi();
  });

  it('renders scenario cards with difficulty and last confidence', async () => {
    render(<LabCatalog onLaunched={vi.fn()} />);
    expect(await screen.findByText('Login Bypass')).toBeInTheDocument();
    expect(screen.getByText('Order Viewer')).toBeInTheDocument();
    expect(screen.getByText('Last confidence: 4/5')).toBeInTheDocument();
    expect(screen.getByText(/1 labs completed/)).toBeInTheDocument();
  });

  it('filters cards when a topic pill is clicked', async () => {
    const user = userEvent.setup();
    render(<LabCatalog onLaunched={vi.fn()} />);
    await screen.findByText('Login Bypass');
    await user.click(screen.getByRole('button', { name: 'SQL injection' }));
    expect(screen.getByText('Login Bypass')).toBeInTheDocument();
    expect(screen.queryByText('Order Viewer')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Order Viewer')).toBeInTheDocument();
  });

  it('launches a scenario and reports the result', async () => {
    const user = userEvent.setup();
    const onLaunched = vi.fn();
    render(<LabCatalog onLaunched={onLaunched} />);
    await user.click(await screen.findByRole('button', { name: /Launch Lab: Order Viewer/ }));
    expect(window.pwnshopApi.launchScenario).toHaveBeenCalledWith('idor-1');
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith(scenarios[1], expect.objectContaining({ port: 18081 })));
  });

  it('resumes the last lab', async () => {
    const user = userEvent.setup();
    render(<LabCatalog onLaunched={vi.fn()} />);
    await screen.findByText('Login Bypass');
    await user.click(screen.getByRole('button', { name: 'Resume Last Lab' }));
    expect(window.pwnshopApi.launchScenario).toHaveBeenCalledWith('sqli-1');
  });

  it('shows an error when launch fails', async () => {
    window.pwnshopApi = makeApi({ launchScenario: vi.fn().mockRejectedValue(new Error('vagrant missing')) });
    const user = userEvent.setup();
    render(<LabCatalog onLaunched={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Launch Lab: Login Bypass/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('vagrant missing');
  });
});
