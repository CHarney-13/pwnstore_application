import { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Docker from 'dockerode';
import { getDockerSocketPath } from './dockerLlmService';

export const DEMO_SCENARIO_ID = 'demo-sqli-01';
export const DEMO_FLAG = 'PWNSHOP{demo_sqli_mastered_2026}';
const CONTAINER_NAME = 'pwnshop-demo-sqli';
const MAX_LOGS = 100;

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isDockerNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404;
}

interface DemoLabServiceOptions {
  docker?: Pick<Docker, 'createContainer' | 'getContainer'> & { modem: Pick<Docker['modem'], 'demuxStream'> };
  statePath: string;
}

export class DemoLabService {
  private readonly docker: NonNullable<DemoLabServiceOptions['docker']>;
  private container: Docker.Container | null = null;
  private logs: string[] = [];
  private stream: Readable | null = null;
  private readonly statePath: string;

  constructor(options: DemoLabServiceOptions) {
    this.docker = options.docker ?? new Docker({ socketPath: getDockerSocketPath(process.platform), timeout: 5000 });
    this.statePath = options.statePath;
  }

  async restore(): Promise<string | null> {
    let token: string;
    try {
      token = await readFile(this.statePath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(token)) {
      throw new Error('Invalid demo lab recovery state. Resolve the saved state before launching another lab.');
    }
    const container = this.docker.getContainer(CONTAINER_NAME);
    try {
      const inspection = await container.inspect();
      if (inspection.Config.Labels?.['org.pwnshop.demo-lab'] !== DEMO_SCENARIO_ID
        || inspection.Config.Labels?.['org.pwnshop.instance'] !== token) {
        throw new Error(`Container ${CONTAINER_NAME} is not a PWNShop demo lab; resolve the name conflict manually.`);
      }
    } catch (error) {
      if (isDockerNotFound(error)) {
        await rm(this.statePath, { force: true });
        return null;
      }
      throw error;
    }
    this.container = container;
    return DEMO_SCENARIO_ID;
  }

  async start(): Promise<number> {
    this.logs = [];
    const token = randomUUID();
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, token, { flag: 'wx' });
    try {
      this.container = await this.docker.createContainer({
        name: CONTAINER_NAME,
        Image: 'pwnshop-demo-sqli:latest',
        Labels: { 'org.pwnshop.demo-lab': DEMO_SCENARIO_ID, 'org.pwnshop.instance': token },
        ExposedPorts: { '3000/tcp': {} },
        HostConfig: { PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] } },
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 409) {
        await rm(this.statePath, { force: true });
      }
      throw error;
    }
    await this.container.start();
    const inspection = await this.container.inspect();
    const bindings = inspection.NetworkSettings.Ports['3000/tcp'];
    const port = Number(bindings?.[0]?.HostPort);
    if (!bindings || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1'
      || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Docker did not publish the demo lab on a valid loopback port.');
    }
    const stream = await this.container.logs({ follow: true, stdout: true, stderr: true, tail: MAX_LOGS });
    if (!(stream instanceof Readable)) throw new Error('Docker did not return a readable log stream.');
    this.stream = stream;
    const makeOutput = (): Writable => {
      const decoder = new StringDecoder('utf8');
      let pending = '';
      return new Writable({
        write: (chunk: Buffer, _encoding, callback) => {
          pending += decoder.write(chunk);
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? '';
          for (const line of lines) this.appendLog(line);
          if (pending.length > 4000) {
            this.appendLog(pending.slice(0, 4000));
            pending = '';
          }
          callback();
        },
        final: (callback) => {
          this.appendLog(pending + decoder.end());
          callback();
        },
      });
    };
    stream.on('error', (error: Error) => {
      console.error('Demo container log stream failed:', error);
      this.appendLog(`Container log stream error: ${error.message}`);
    });
    this.docker.modem.demuxStream(stream, makeOutput(), makeOutput());
    return port;
  }

  async stop(): Promise<void> {
    if (!this.container && !await this.restore()) return;
    try {
      await this.container!.remove({ force: true });
    } catch (error) {
      if (!isDockerNotFound(error)) throw error;
    }
    this.stream?.destroy();
    this.stream = null;
    this.container = null;
    await rm(this.statePath, { force: true });
  }

  verifyFlag(submitted: string): boolean {
    return submitted.trim() === DEMO_FLAG;
  }

  getRecentLogs(): string[] {
    return [...this.logs];
  }

  private appendLog(chunk: string): void {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      this.logs.push(line.slice(0, 4000));
    }
    this.logs = this.logs.slice(-MAX_LOGS);
  }
}
