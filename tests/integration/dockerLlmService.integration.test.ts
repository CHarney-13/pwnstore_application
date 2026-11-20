import { describe, expect, it, vi } from 'vitest';
import { DockerLlmService } from '../../src/main/services/dockerLlmService';

describe('Docker Model Runner integration boundary', () => {
  it('uses the installed model for OpenAI chat', async () => {
    const command = vi.fn(async (args: string[]) => args[1] === 'list'
      ? JSON.stringify({ data: [{ id: 'huggingface.co/qwen/qwen2.5-coder-1.5b-instruct-gguf:latest' }] })
      : 'running');
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'POST' ? { choices: [{ message: { content: 'hint' } }] } : {})));
    const service = new DockerLlmService({ command, fetchImpl, docker: { ping: vi.fn().mockResolvedValue('OK') } });
    expect((await service.checkHealth()).llmRunning).toBe(true);
    expect(await service.queryAiHelper('Help', { id: 's', name: 'lab', description: '', vulnerabilities: [], services: [] })).toBe('hint');
  });
});
