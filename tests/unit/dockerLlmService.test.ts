import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DockerLlmService } from '../../src/main/services/dockerLlmService';

const model = 'hf.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF';
const context = { id: 's', name: 'SQL injection', description: 'Lab', vulnerabilities: [], services: [] };

function setup() {
  const command = vi.fn(async (args: string[]) => args[1] === 'status'
    ? 'Model Runner is running'
    : JSON.stringify({ data: [{ id: model }] }));
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? new Response(JSON.stringify({ choices: [{ message: { content: 'A hint' } }] }))
    : new Response('{}'));
  const docker = { ping: vi.fn().mockResolvedValue('OK') };
  return { command, fetchImpl, docker, retryDelay: vi.fn().mockResolvedValue(undefined) };
}

describe('Docker Model Runner', () => {
  it('checks status, installed model and responsive OpenAI endpoint', async () => {
    const mocks = setup();
    const service = new DockerLlmService(mocks);
    expect(await service.checkHealth()).toMatchObject({ dockerConnected: true, llmRunning: true, modelAvailable: true });
    expect(mocks.command).toHaveBeenCalledWith(['model', 'status']);
    expect(mocks.command).toHaveBeenCalledWith(['model', 'list', '--openai']);
    expect(mocks.fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:12434/engines/v1/models', expect.anything());
  });

  it('detects an absent required model without retrying the runner', async () => {
    const mocks = setup();
    mocks.command.mockImplementation(async (args) => args[1] === 'list' ? '{"data":[]}' : 'running');
    const health = await new DockerLlmService(mocks).checkHealth();
    expect(health).toMatchObject({ llmRunning: false, modelAvailable: false });
    expect(health.error).toMatch(/model.*not installed/i);
    expect(mocks.command).toHaveBeenCalledTimes(2);
  });

  it('retries a failed connection three times and logs diagnostics', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dmr-test-'));
    const dir = path.join(root, 'debug');
    try {
      const mocks = setup();
      mocks.command.mockRejectedValue(new Error('status stderr'));
      const health = await new DockerLlmService({ ...mocks, debugDirectory: dir }).checkHealth();
      expect(health.llmRunning).toBe(false);
      expect(health.error).toMatch(/3.*attempt/i);
      expect(mocks.command).toHaveBeenCalledTimes(4);
      expect(mocks.retryDelay).toHaveBeenCalledTimes(3);
      const log = await readFile(path.join(dir, 'model-runner.log'), 'utf8');
      expect(log).toMatch(/Timestamp: \d{4}-/);
      expect(log).toContain('docker model status');
      expect(log).toContain('status stderr');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('recovers after a transient health endpoint failure', async () => {
    const mocks = setup();
    mocks.fetchImpl.mockRejectedValueOnce(new Error('offline'));
    expect((await new DockerLlmService(mocks).checkHealth()).llmRunning).toBe(true);
    expect(mocks.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('preserves the installed-model status if the HTTP endpoint remains unresponsive', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dmr-test-'));
    try {
      const mocks = setup();
      mocks.fetchImpl.mockRejectedValue(new Error('connection refused'));
      const health = await new DockerLlmService({ ...mocks, debugDirectory: root }).checkHealth();
      expect(health).toMatchObject({ dockerConnected: true, runnerRunning: true, modelAvailable: true, llmRunning: false });
      expect(mocks.fetchImpl).toHaveBeenCalledTimes(4);
      expect(await readFile(path.join(root, 'model-runner.log'), 'utf8')).toContain('connection refused');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the installed quantized variant in the completion request', async () => {
    const mocks = setup();
    mocks.command.mockImplementation(async (args) => args[1] === 'list'
      ? JSON.stringify({ data: [{ id: `${model}:Q4_K_M` }] }) : 'running');
    const service = new DockerLlmService(mocks);
    expect((await service.checkHealth()).llmRunning).toBe(true);
    await service.queryAiHelper('Help', context);
    expect(mocks.fetchImpl.mock.calls[1][1]?.body).toContain(`${model}:Q4_K_M`);
  });

  it('sends an OpenAI request without flag values', async () => {
    const mocks = setup();
    const service = new DockerLlmService(mocks);
    expect(await service.queryAiHelper('Help FLAG{secret}', context, ['FLAG{secret}'])).toBe('A hint');
    const [url, init] = mocks.fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:12434/engines/v1/chat/completions');
    expect(init?.body).not.toContain('FLAG{secret}');
    expect(init?.body).toContain(model);
  });
});
