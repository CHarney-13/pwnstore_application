import Docker from 'dockerode';
import type { DockerLlmStatus, SecGenScenarioContext } from '../../shared/types';

const LOOPBACK = '127.0.0.1';
const PORT = 11434;
const MODEL = 'qwen2.5-coder:1.5b';
const CONTAINER_NAME = 'pwnstore-ollama';
const VOLUME_NAME = 'pwnstore-ollama-data';
const IMAGE = 'ollama/ollama:latest';
const API_BASE_URL = `http://${LOOPBACK}:${PORT}`;

interface DockerLlmServiceOptions {
  docker?: Docker;
  platform?: NodeJS.Platform;
  fetchImpl?: typeof fetch;
  image?: string;
  model?: string;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

export function getDockerSocketPath(platform: NodeJS.Platform): string {
  return platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock';
}

function cleanStudentText(value: string): string {
  return value
    .replace(/<(?:flag|secret|answer)\b[^>]*>[\s\S]*?<\/(?:flag|secret|answer)>/gi, '[redacted]')
    .replace(/\b(?:flag|ctf)\s*[{=:]\s*[^}\r\n]+}?/gi, '[redacted]')
    .slice(0, 4_000);
}

function contextForPrompt(context: SecGenScenarioContext): string {
  return JSON.stringify({
    name: cleanStudentText(context.name),
    description: cleanStudentText(context.description),
    vulnerabilities: context.vulnerabilities.map(cleanStudentText),
    services: context.services.map(cleanStudentText),
  });
}

export class DockerLlmService {
  private readonly docker: Docker;
  private readonly fetchImpl: typeof fetch;
  private readonly image: string;
  private readonly model: string;

  constructor(options: DockerLlmServiceOptions = {}) {
    this.docker = options.docker ?? new Docker({
      socketPath: getDockerSocketPath(options.platform ?? process.platform),
    });
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.image = options.image ?? IMAGE;
    this.model = options.model ?? MODEL;
  }

  async ensureLlmContainerRunning(): Promise<DockerLlmStatus> {
    await this.docker.ping();
    const images = await this.docker.listImages({
      filters: { reference: [this.image] },
    });
    if (images.length === 0) await this.pullImage();

    const volumeResult = await this.docker.listVolumes({
      filters: { name: [VOLUME_NAME] },
    });
    if (!volumeResult.Volumes?.some((volume) => volume.Name === VOLUME_NAME)) {
      await this.docker.createVolume({ Name: VOLUME_NAME });
    }

    const existing = await this.docker.listContainers({
      all: true,
      filters: { name: [CONTAINER_NAME] },
    });
    const matching = existing.find((container) =>
      container.Names?.includes(`/${CONTAINER_NAME}`),
    );

    if (matching) {
      const container = this.docker.getContainer(matching.Id);
      const inspection = await container.inspect();
      this.assertLoopbackBinding(inspection.HostConfig?.PortBindings);
      if (!inspection.State?.Running) await container.start();
      return this.status(matching.Id);
    }

    const container = await this.docker.createContainer({
      Image: this.image,
      name: CONTAINER_NAME,
      ExposedPorts: { [`${PORT}/tcp`]: {} },
      HostConfig: {
        PortBindings: {
          [`${PORT}/tcp`]: [{ HostIp: LOOPBACK, HostPort: String(PORT) }],
        },
        Mounts: [{
          Type: 'volume',
          Source: VOLUME_NAME,
          Target: '/root/.ollama',
        }],
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });
    await container.start();
    return this.status(container.id);
  }

  async queryAiHelper(
    studentQuestion: string,
    currentSecGenScenarioContext: SecGenScenarioContext,
    recentAttemptLogs: string[] = [],
  ): Promise<string> {
    const systemPrompt = [
      'You are a cybersecurity education tutor for an authorized, isolated local lab.',
      'Explain the relevant vulnerability and diagnose why an attempt may have failed.',
      'Never provide a flag, secret, complete exploit string, or step-by-step compromise payload.',
      'Give conceptual, defensive, and incremental guidance; keep all advice scoped to this lab.',
      'Flag-hint values are intentionally not supplied to you.',
      `Scenario context: ${contextForPrompt(currentSecGenScenarioContext)}`,
      `Recent attempts: ${JSON.stringify(recentAttemptLogs.slice(-10).map(cleanStudentText))}`,
    ].join('\n');

    const response = await this.fetchImpl(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: cleanStudentText(studentQuestion) },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Local LLM request failed with HTTP ${response.status}.`);
    }

    const result = await response.json() as OllamaChatResponse;
    const answer = result.message?.content;
    if (!answer) throw new Error('Local LLM returned an empty response.');
    return answer;
  }

  private async pullImage(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.docker.pull(
        this.image,
        (error: Error | null, stream?: NodeJS.ReadableStream) => {
            if (error) {
              reject(error);
              return;
            }
            if (!stream) {
              reject(new Error('Docker did not return an image-pull stream.'));
              return;
            }
          stream.on('error', reject);
          stream.on('end', resolve);
        },
      );
    });
  }

  private assertLoopbackBinding(
    bindings?: Record<string, Array<{ HostIp?: string }> | null>,
  ): void {
    const portBindings = bindings?.[`${PORT}/tcp`];
    if (!portBindings?.length || portBindings.some((binding) => binding?.HostIp !== LOOPBACK)) {
      throw new Error('The existing LLM container is not bound exclusively to 127.0.0.1.');
    }
  }

  private status(containerId?: string): DockerLlmStatus {
    return {
      running: true,
      image: this.image,
      model: this.model,
      baseUrl: API_BASE_URL,
      port: PORT,
      ...(containerId ? { containerId } : {}),
    };
  }
}
