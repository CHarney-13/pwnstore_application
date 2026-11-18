import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Docker from 'dockerode';
import { DockerLlmService, getDockerSocketPath } from '../../src/main/services/dockerLlmService';
import type { SecGenScenarioContext } from '../../src/shared/types';

const { dockerConstructorMock } = vi.hoisted(() => ({
  dockerConstructorMock: vi.fn(),
}));
vi.mock('dockerode', () => ({ default: dockerConstructorMock }));

const secretFromFixture = 'FLAG{fixture-only-secret}';

function createDockerMock() {
  const pullStream = new EventEmitter();
  const start = vi.fn().mockResolvedValue(undefined);
  const docker = {
    ping: vi.fn().mockResolvedValue(undefined),
    listImages: vi.fn().mockResolvedValue([]),
    pull: vi.fn((_image: string, callback: (error: Error | null, stream?: EventEmitter) => void) => {
      callback(null, pullStream);
      queueMicrotask(() => pullStream.emit('end'));
    }),
    listVolumes: vi.fn().mockResolvedValue({ Volumes: [] }),
    createVolume: vi.fn().mockResolvedValue({}),
    listContainers: vi.fn().mockResolvedValue([]),
    createContainer: vi.fn().mockResolvedValue({ id: 'container-id', start }),
    getContainer: vi.fn(),
  };
  return { docker, start, pullStream };
}

const context: SecGenScenarioContext = {
  id: 'scenario-42',
  name: 'Intro to SQL Injection',
  description: 'A local practice scenario.',
  vulnerabilities: ['SQL injection'],
  services: ['HTTP'],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('DockerLlmService', () => {
  it('selects Windows named pipe and Linux Docker socket paths', () => {
    expect(getDockerSocketPath('win32')).toBe('//./pipe/docker_engine');
    expect(getDockerSocketPath('linux')).toBe('/var/run/docker.sock');
  });

  it('configures dockerode with the current platform socket', () => {
    new DockerLlmService({ platform: 'win32' });

    expect(dockerConstructorMock).toHaveBeenCalledWith({
      socketPath: '//./pipe/docker_engine',
    });
  });

  it('reports health for offline Docker, stopped LLM, and running LLM', async () => {
    const { docker } = createDockerMock();
    const service = new DockerLlmService({ docker: docker as unknown as Docker });

    docker.ping.mockRejectedValueOnce(new Error('no daemon'));
    expect(await service.checkHealth()).toEqual({ dockerConnected: false, llmRunning: false });

    docker.listContainers.mockResolvedValueOnce([]);
    expect(await service.checkHealth()).toEqual({ dockerConnected: true, llmRunning: false });

    docker.listContainers.mockResolvedValueOnce([{ Names: ['/pwnstore-ollama'] }]);
    expect(await service.checkHealth()).toEqual({ dockerConnected: true, llmRunning: true });

    docker.listContainers.mockRejectedValueOnce(new Error('x'));
    expect(await service.checkHealth()).toEqual({ dockerConnected: true, llmRunning: false });
  });

  it('pulls the image, creates persistent storage, and binds only to loopback', async () => {
    const { docker, start } = createDockerMock();
    const service = new DockerLlmService({ docker: docker as unknown as Docker });

    const status = await service.ensureLlmContainerRunning();

    expect(status).toMatchObject({
      running: true,
      baseUrl: 'http://127.0.0.1:11434',
      port: 11434,
    });
    expect(docker.ping).toHaveBeenCalledOnce();
    expect(docker.pull).toHaveBeenCalledOnce();
    expect(docker.createVolume).toHaveBeenCalledWith({ Name: 'pwnstore-ollama-data' });
    expect(docker.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      HostConfig: expect.objectContaining({
        PortBindings: {
          '11434/tcp': [{ HostIp: '127.0.0.1', HostPort: '11434' }],
        },
        Mounts: [expect.objectContaining({
          Type: 'volume',
          Source: 'pwnstore-ollama-data',
          Target: '/root/.ollama',
        })],
      }),
    }));
    expect(start).toHaveBeenCalledOnce();
  });

  it('rejects an existing container with a non-loopback port binding', async () => {
    const { docker } = createDockerMock();
    docker.listImages.mockResolvedValue([{ Id: 'image-id' }]);
    docker.listVolumes.mockResolvedValue({ Volumes: [{ Name: 'pwnstore-ollama-data' }] });
    docker.listContainers.mockResolvedValue([{
      Id: 'container-id',
      Names: ['/pwnstore-ollama'],
    }]);
    docker.getContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        HostConfig: {
          PortBindings: { '11434/tcp': [{ HostIp: '0.0.0.0' }] },
        },
        State: { Running: true },
      }),
    });
    const service = new DockerLlmService({ docker: docker as unknown as Docker });

    await expect(service.ensureLlmContainerRunning())
      .rejects.toThrow('not bound exclusively to 127.0.0.1');
  });

  it('builds a pedagogical request without forwarding flag-hint values', async () => {
    const { docker } = createDockerMock();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: { content: 'Consider how input reaches the query.' } }),
      { status: 200 },
    ));
    const service = new DockerLlmService({
      docker: docker as unknown as Docker,
      fetchImpl,
    });

    await expect(service.queryAiHelper(
      `Why did this fail? ${secretFromFixture}`,
      context,
      [`Attempt included ${secretFromFixture}`],
    )).resolves.toContain('Consider how input');

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const serializedRequest = JSON.stringify(body);
    expect(serializedRequest).not.toContain(secretFromFixture);
    expect(serializedRequest).toContain('Never provide a flag');
    expect(serializedRequest).toContain('SQL injection');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces local model HTTP errors', async () => {
    const { docker } = createDockerMock();
    const service = new DockerLlmService({
      docker: docker as unknown as Docker,
      fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 503 })),
    });

    await expect(service.queryAiHelper('Help', context))
      .rejects.toThrow('HTTP 503');
  });
});
