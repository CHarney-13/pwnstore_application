import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoLabService, DEMO_FLAG } from '../../src/main/services/demoLabService';
import { DockerLlmService } from '../../src/main/services/dockerLlmService';
import { SCENARIO_CATALOG } from '../../src/main/scenarioCatalog';

const temporaryDirectories: string[] = [];
const token = '12345678-1234-4234-8234-123456789abc';

function setup() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'pwnshop-demo-'));
  temporaryDirectories.push(directory);
  const statePath = path.join(directory, 'active');
  const stream = new PassThrough();
  const container = {
    start: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ NetworkSettings: { Ports: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '49152' }] } } }),
    logs: vi.fn().mockResolvedValue(stream),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const docker = {
    createContainer: vi.fn().mockResolvedValue(container),
    getContainer: vi.fn().mockReturnValue(container),
    modem: { demuxStream: vi.fn((source, stdout) => source.pipe(stdout)) },
  };
  return { stream, container, docker, statePath, service: new DemoLabService({ docker, statePath }) };
}

describe('demo SQL injection lab', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });
  it('creates a dynamically assigned loopback-only port and removes the container', async () => {
    const { service, docker, container } = setup();
    expect(await service.start()).toBe(49152);
    expect(docker.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Image: 'pwnshop-demo-sqli:latest',
      HostConfig: expect.objectContaining({ PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] } }),
    }));
    await service.stop();
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  it('verifies only the demo flag', () => {
    const { service } = setup();
    expect(service.verifyFlag(` ${DEMO_FLAG} `)).toBe(true);
    expect(service.verifyFlag('PWNSHOP{wrong}')).toBe(false);
  });

  it('sends hints and recent container logs to the AI without exposing the flag', async () => {
    const { service, stream } = setup();
    await service.start();
    stream.write(`POST /login failed ${DEMO_FLAG}\n`);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'hint' } }] })));
    const llm = new DockerLlmService({ fetchImpl });
    const context = SCENARIO_CATALOG.find((item) => item.context.id === 'demo-sqli-01')!.context;
    await llm.queryAiHelper(`What about ${DEMO_FLAG}?`, context, service.getRecentLogs());
    const request = String(fetchImpl.mock.calls[0][1].body);
    expect(request).toContain('POST /login failed');
    expect(request).toContain('hints');
    expect(request).toContain('SQL injection');
    expect(request).not.toContain(DEMO_FLAG);
  });

  it('rejects and cleans up a non-loopback port published by Docker', async () => {
    const { service, container } = setup();
    container.inspect.mockResolvedValue({ NetworkSettings: { Ports: { '3000/tcp': [{ HostIp: '0.0.0.0', HostPort: '49152' }] } } });
    await expect(service.start()).rejects.toThrow(/loopback/i);
    await service.stop();
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  it('restores only a container bearing the demo lab ownership label', async () => {
    const { service, container, statePath } = setup();
    writeFileSync(statePath, token);
    container.inspect.mockResolvedValueOnce({ Config: { Labels: { 'org.pwnshop.demo-lab': 'demo-sqli-01', 'org.pwnshop.instance': token } } });
    expect(await service.restore()).toBe('demo-sqli-01');
    await service.stop();
    expect(container.remove).toHaveBeenCalledOnce();

    writeFileSync(statePath, token);
    container.inspect.mockResolvedValueOnce({ Config: { Labels: {} } });
    await expect(service.restore()).rejects.toThrow(/name conflict/i);
  });

  it('does not contact Docker when no demo recovery is pending', async () => {
    const { service, docker } = setup();
    expect(await service.restore()).toBeNull();
    expect(docker.getContainer).not.toHaveBeenCalled();
  });

  it('clears stale recovery state when Docker reports the container is absent', async () => {
    const { service, container, statePath } = setup();
    writeFileSync(statePath, token);
    container.inspect.mockRejectedValueOnce({ statusCode: 404 });
    expect(await service.restore()).toBeNull();
    expect(await service.restore()).toBeNull();
    expect(container.inspect).toHaveBeenCalledOnce();
  });

  it('retains recoverable state until cleanup succeeds after a failed launch', async () => {
    const { service, docker, container, statePath } = setup();
    docker.createContainer.mockRejectedValueOnce(new Error('connection lost'));
    container.inspect.mockRejectedValueOnce(new Error('Docker unavailable'));
    await expect(service.start()).rejects.toThrow('connection lost');
    await expect(service.stop()).rejects.toThrow('Docker unavailable');
    container.inspect.mockResolvedValueOnce({ Config: { Labels: { 'org.pwnshop.demo-lab': 'demo-sqli-01', 'org.pwnshop.instance': readFileSync(statePath, 'utf8') } } });
    await service.stop();
    expect(container.remove).toHaveBeenCalledWith({ force: true });
    expect(await service.restore()).toBeNull();
  });

  it('does not remove an existing container after a Docker name conflict', async () => {
    const { service, docker, container } = setup();
    docker.createContainer.mockRejectedValueOnce({ statusCode: 409 });
    await expect(service.start()).rejects.toMatchObject({ statusCode: 409 });
    await service.stop();
    expect(container.remove).not.toHaveBeenCalled();
  });
});
