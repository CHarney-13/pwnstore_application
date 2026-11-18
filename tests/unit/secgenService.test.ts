import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SecGenService, getSecGenProjectPath, parseScenarioXml } from '../../src/main/services/secgenService';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const fixtureDirectory = path.join(import.meta.dirname, 'fixtures');
const scenarioFixture = path.join(fixtureDirectory, 'scenario.xml');
const hintsFixture = path.join(fixtureDirectory, 'flag_hints.xml');
let temporaryDirectory: string;
let secgenDirectory: string;
let scenarioPath: string;

function mockSuccessfulSpawn(): void {
  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const process = new EventEmitter() as EventEmitter & {
      stderr: PassThrough;
      stdout: PassThrough;
    };
    process.stderr = new PassThrough();
    process.stdout = new PassThrough();

    const outputIndex = args.indexOf('-o');
    if (outputIndex === -1) {
      queueMicrotask(() => process.emit('close', 0));
      return process;
    }

    const projectDirectory = args[outputIndex + 1];
    void (async () => {
      await mkdir(projectDirectory, { recursive: true });
      await copyFile(scenarioFixture, path.join(projectDirectory, 'scenario.xml'));
      await copyFile(hintsFixture, path.join(projectDirectory, 'flag_hints.xml'));
      await writeFile(
        path.join(projectDirectory, 'Vagrantfile'),
        'config.vm.network "forwarded_port", guest: 80, host: 8080, host_ip: "127.0.0.1"',
      );
      process.emit('close', 0);
    })();

    return process;
  });
}

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'pwnstore-secgen-'));
  secgenDirectory = path.join(temporaryDirectory, 'secgen');
  await mkdir(secgenDirectory, { recursive: true });
  await writeFile(path.join(secgenDirectory, 'secgen.rb'), '');
  scenarioPath = path.join(temporaryDirectory, 'input.xml');
  await copyFile(scenarioFixture, scenarioPath);
  mockSuccessfulSpawn();
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('SecGenService', () => {
  it('parses scenario XML into safe scenario metadata', () => {
    const xml = '<scenario id="s1" name="Example"><description>Training</description><vulnerability name="XSS"/><service name="HTTP"/></scenario>';
    expect(parseScenarioXml(xml)).toEqual({
      id: 's1',
      name: 'Example',
      description: 'Training',
      vulnerabilities: ['XSS'],
      services: ['HTTP'],
    });
  });

  it('validates SecGen, Ruby, and Vagrant prerequisites', async () => {
    const service = new SecGenService({ secgenDirectory });
    await expect(service.validatePrerequisites()).resolves.toEqual({
      valid: true,
      errors: [],
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('generates a project, parses both XML outputs, and verifies a flag privately', async () => {
    const service = new SecGenService({
      secgenDirectory,
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    });

    const scenario = await service.generateScenario(scenarioPath);

    expect(scenario.name).toBe('Intro to SQL Injection');
    expect(scenario.vulnerabilities).toEqual(['SQL injection']);
    expect(await readFile(path.join(scenario.projectDirectory, 'flag_hints.xml'), 'utf8'))
      .toContain('FLAG{fixture-only-secret}');
    expect(service.verifyFlag('FLAG{fixture-only-secret}')).toBe(true);
    expect(service.verifyFlag('incorrect')).toBe(false);
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['-s', path.resolve(scenarioPath), '-o', scenario.projectDirectory]),
      expect.objectContaining({ shell: false }),
    );
  });

  it('starts and stops only a lab whose forwarded ports are loopback-bound', async () => {
    const service = new SecGenService({ secgenDirectory });
    const scenario = await service.generateScenario(scenarioPath);

    await service.startTargetLab();
    await service.stopTargetLab();

    expect(spawnMock).toHaveBeenCalledWith(
      'vagrant',
      ['up'],
      expect.objectContaining({ cwd: scenario.projectDirectory }),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      'vagrant',
      ['halt'],
      expect.objectContaining({ cwd: scenario.projectDirectory }),
    );
  });

  it('rejects a generated Vagrantfile that exposes a forwarded port to the LAN', async () => {
    const service = new SecGenService({ secgenDirectory });
    const scenario = await service.generateScenario(scenarioPath);
    await writeFile(
      path.join(scenario.projectDirectory, 'Vagrantfile'),
      'config.vm.network "forwarded_port", guest: 80, host: 8080',
    );

    await expect(service.startTargetLab()).rejects.toThrow('must bind to 127.0.0.1');
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('uses platform-appropriate project path separators', () => {
    expect(getSecGenProjectPath('C:\\labs\\projects', '2026-01-02T03:04:05.000Z', 'win32'))
      .toBe('C:\\labs\\projects\\SecGen_2026-01-02T03-04-05-000Z');
    expect(getSecGenProjectPath('/labs/projects', '2026-01-02T03:04:05.000Z', 'linux'))
      .toBe('/labs/projects/SecGen_2026-01-02T03-04-05-000Z');
  });
});
