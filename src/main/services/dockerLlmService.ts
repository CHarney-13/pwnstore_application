import { execFile } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import Docker from 'dockerode';
import type { SecGenScenarioContext } from '../../shared/types';

const MODEL = 'hf.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF';
const API_BASE_URL = 'http://127.0.0.1:12434/engines/v1';
const execFileAsync = promisify(execFile);

interface DockerLlmServiceOptions {
  docker?: Pick<Docker, 'ping'>;
  platform?: NodeJS.Platform;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  command?: (args: string[]) => Promise<string>;
  model?: string;
  debugDirectory?: string;
  retryDelay?: () => Promise<void>;
}

interface ModelHealth {
  dockerConnected: boolean;
  llmRunning: boolean;
  runnerRunning: boolean;
  modelAvailable: boolean;
  error?: string;
}

export function getDockerSocketPath(platform: NodeJS.Platform): string {
  return platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock';
}

function cleanStudentText(value: string): string {
  return value
    .replace(/<(?:flag|secret|answer)\b[^>]*>[\s\S]*?<\/(?:flag|secret|answer)>/gi, '[redacted]')
    .replace(/\bPWNSHOP\s*\{[^}\r\n]*\}/gi, '[redacted]')
    .replace(/\b(?:flag|ctf)\s*[{=:]\s*[^}\r\n]+}?/gi, '[redacted]')
    .slice(0, 4_000);
}

function details(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const commandError = error as Error & { stdout?: string; stderr?: string };
  return [error.stack ?? error.message, commandError.stdout, commandError.stderr].filter(Boolean).join('\n');
}

function normalizeModelName(name: string): string {
  return name.toLowerCase().replace(/^hf\.co\//, 'huggingface.co/');
}

export class DockerLlmService {
  private readonly docker: Pick<Docker, 'ping'>;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly command: (args: string[]) => Promise<string>;
  private readonly model: string;
  private readonly debugDirectory: string;
  private readonly retryDelay: () => Promise<void>;
  private selectedModel: string;
  private pendingHealth: Promise<ModelHealth> | null = null;

  constructor(options: DockerLlmServiceOptions = {}) {
    this.docker = options.docker ?? new Docker({
      socketPath: getDockerSocketPath(options.platform ?? process.platform),
      timeout: 5000,
    });
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.command = options.command ?? (async (args) => {
      const { stdout } = await execFileAsync('docker', args, { timeout: 8000, windowsHide: true });
      return stdout;
    });
    this.model = options.model ?? MODEL;
    this.selectedModel = this.model;
    this.debugDirectory = options.debugDirectory ?? path.join(process.cwd(), 'debug');
    this.retryDelay = options.retryDelay ?? (() => new Promise((resolve) => setTimeout(resolve, 1000)));
  }

  checkHealth(): Promise<ModelHealth> {
    if (!this.pendingHealth) {
      this.pendingHealth = this.checkHealthWithRetry().finally(() => { this.pendingHealth = null; });
    }
    return this.pendingHealth;
  }

  private async checkHealthWithRetry(): Promise<ModelHealth> {
    const diagnostics: string[] = [];
    let dockerConnected = false;
    let runnerRunning = false;
    let modelAvailable = false;
    for (let attempt = 0; attempt <= 3; attempt++) {
      let status = '(status command did not complete)';
      dockerConnected = false;
      runnerRunning = false;
      modelAvailable = false;
      try {
        await this.docker.ping();
        dockerConnected = true;
        status = await this.command(['model', 'status']);
        if (/\b(?:not running|stopped|disabled|not enabled)\b/i.test(status.split(/\r?\n/, 1)[0])) throw new Error('Docker Model Runner is not running.');
        runnerRunning = true;
        const output = await this.command(['model', 'list', '--openai']);
        const parsed: unknown = JSON.parse(output);
        if (!parsed || typeof parsed !== 'object' || !('data' in parsed) || !Array.isArray(parsed.data)) {
          throw new Error('Unexpected docker model list output.');
        }
        const modelName = normalizeModelName(this.model);
        const installed = parsed.data.find((item: unknown) => {
          if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string') return false;
          const id = normalizeModelName(item.id);
          return id === modelName || id.startsWith(`${modelName}:`);
        }) as { id: string } | undefined;
        if (!installed) {
          return { dockerConnected: true, llmRunning: false, runnerRunning: true, modelAvailable: false, error: `Required model ${this.model} is not installed. Pull it with docker model pull ${this.model}.` };
        }
        modelAvailable = true;
        const response = await this.fetchImpl(`${API_BASE_URL}/models`, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`Model Runner health endpoint returned HTTP ${response.status}.`);
        this.selectedModel = installed.id;
        return { dockerConnected: true, llmRunning: true, runnerRunning: true, modelAvailable: true };
      } catch (error) {
        if (!dockerConnected) {
          try {
            status = await this.command(['model', 'status']);
          } catch (statusError) {
            status = details(statusError);
          }
        }
        diagnostics.push(`Attempt ${attempt + 1}\ndocker model status:\n${status}\n${details(error)}`);
        if (attempt < 3) await this.retryDelay();
      }
    }
    const message = 'Docker Model Runner is unavailable after 3 recovery attempts. Enable Model Runner and host-side TCP access, then retry.';
    try {
      await mkdir(this.debugDirectory, { recursive: true });
      await appendFile(path.join(this.debugDirectory, 'model-runner.log'), `Timestamp: ${new Date().toISOString()}\n${diagnostics.join('\n\n')}\n\n`, 'utf8');
    } catch (error) {
      return { dockerConnected, llmRunning: false, runnerRunning, modelAvailable, error: `${message} Could not write debug log: ${details(error)}` };
    }
    return { dockerConnected, llmRunning: false, runnerRunning, modelAvailable, error: message };
  }

  async queryAiHelper(
    studentQuestion: string,
    context: SecGenScenarioContext,
    recentAttemptLogs: string[] = [],
  ): Promise<string> {
    const safeContext = {
      name: cleanStudentText(context.name),
      description: cleanStudentText(context.description),
      vulnerabilities: context.vulnerabilities.map(cleanStudentText),
      services: context.services.map(cleanStudentText),
      hints: context.hints?.map(cleanStudentText),
    };
    const systemPrompt = [
      'You are a cybersecurity education tutor for an authorized, isolated local lab.',
      'Explain the relevant vulnerability and diagnose why an attempt may have failed.',
      'Never provide a flag, secret, complete exploit string, or step-by-step compromise payload.',
      'Give conceptual, defensive, and incremental guidance; keep all advice scoped to this lab.',
      'Flag-hint values are intentionally not supplied to you.',
      `Scenario context: ${JSON.stringify(safeContext)}`,
      `Recent attempts: ${JSON.stringify(recentAttemptLogs.slice(-10).map(cleanStudentText))}`,
    ].join('\n');
    const response = await this.fetchImpl(`${API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: this.selectedModel,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: cleanStudentText(studentQuestion) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Local LLM request failed with HTTP ${response.status}.`);
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const answer = result.choices?.[0]?.message?.content;
    if (!answer) throw new Error('Local LLM returned an empty response.');
    return answer;
  }
}
