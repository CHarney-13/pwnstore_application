import { describe, expect, it, vi } from 'vitest';
import type Docker from 'dockerode';
import { DockerLlmService } from '../../src/main/services/dockerLlmService';

describe('Docker LLM service integration', () => {
  it('checks daemon connectivity and passes loopback-only ports to container creation', async () => {
    const containerStart = vi.fn().mockResolvedValue(undefined);
    const docker = {
      ping: vi.fn().mockResolvedValue('OK'),
      listImages: vi.fn().mockResolvedValue([{ Id: 'ollama-image' }]),
      pull: vi.fn(),
      listVolumes: vi.fn().mockResolvedValue({
        Volumes: [{ Name: 'pwnstore-ollama-data' }],
      }),
      createVolume: vi.fn(),
      listContainers: vi.fn().mockResolvedValue([]),
      createContainer: vi.fn().mockResolvedValue({
        id: 'ollama-container',
        start: containerStart,
      }),
      getContainer: vi.fn(),
    };
    const service = new DockerLlmService({ docker: docker as unknown as Docker });

    const health = await service.ensureLlmContainerRunning();

    expect(docker.ping).toHaveBeenCalledOnce();
    expect(docker.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      HostConfig: expect.objectContaining({
        PortBindings: {
          '11434/tcp': [{ HostIp: '127.0.0.1', HostPort: '11434' }],
        },
      }),
    }));
    expect(containerStart).toHaveBeenCalledOnce();
    expect(health.running).toBe(true);
  });
});
