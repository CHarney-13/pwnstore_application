import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type {
  SecGenPrerequisiteStatus,
  SecGenScenario,
  SecGenScenarioContext,
} from '../../shared/types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

interface SecGenServiceOptions {
  secgenDirectory: string;
  projectsDirectory?: string;
  platform?: NodeJS.Platform;
  rubyCommand?: string;
  vagrantCommand?: string;
  now?: () => Date;
}

interface CommandOptions {
  cwd: string;
}

function runCommand(
  command: string,
  args: string[],
  options: CommandOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
    });
    let stderr = '';

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(
        `${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
      ));
    });
  });
}

function collectMatchingValues(
  value: unknown,
  matcher: RegExp,
  results: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectMatchingValues(item, matcher, results);
    return results;
  }
  if (value === null || typeof value !== 'object') return results;

  for (const [key, nested] of Object.entries(value)) {
    if (matcher.test(key)) {
      if (typeof nested === 'string' || typeof nested === 'number') {
        results.push(String(nested));
      } else if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const attributes = nested as Record<string, unknown>;
        for (const attribute of ['@_name', '@_id', '@_type']) {
          const candidate = attributes[attribute];
          if (typeof candidate === 'string' || typeof candidate === 'number') {
            results.push(String(candidate));
          }
        }
      }
    }
    collectMatchingValues(nested, matcher, results);
  }
  return results;
}

function firstMatchingText(value: unknown, matcher: RegExp): string {
  return collectMatchingValues(value, matcher)[0] ?? '';
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function parseScenarioXml(xml: string): SecGenScenarioContext {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const rootName = Object.keys(parsed)[0] ?? 'SecGen scenario';
  const root = parsed[rootName] ?? parsed;
  const rootAttributes = root as Record<string, unknown>;
  const rootId = rootAttributes['@_id'] ?? rootAttributes['@_scenario_id'];
  const rootTitle = rootAttributes['@_name']
    ?? rootAttributes['@_scenario_name']
    ?? rootAttributes['@_title'];

  return {
    id: typeof rootId === 'string' || typeof rootId === 'number'
      ? String(rootId)
      : firstMatchingText(root, /^(?:@_)?(?:id|scenario_id)$/i),
    name: typeof rootTitle === 'string' || typeof rootTitle === 'number'
      ? String(rootTitle)
      : firstMatchingText(root, /^(?:@_)?(?:scenario_name|name|title)$/i) || rootName,
    description: firstMatchingText(root, /^(?:description|summary)$/i),
    vulnerabilities: unique(collectMatchingValues(root, /vulnerab|weakness|exploit/i)),
    services: unique(collectMatchingValues(root, /^(?:service|service_name)$/i)),
  };
}

export function getSecGenProjectPath(
  projectsDirectory: string,
  timestamp: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  return pathApi.join(projectsDirectory, `SecGen_${safeTimestamp}`);
}

function extractFlagValues(value: unknown, values: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) extractFlagValues(item, values);
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const [key, nested] of Object.entries(value)) {
    if (/flag/i.test(key)) {
      if (typeof nested === 'string' || typeof nested === 'number') {
        values.add(String(nested));
      } else if (nested && typeof nested === 'object') {
        extractFlagValues(nested, values);
      }
    } else {
      extractFlagValues(nested, values);
    }
  }
}

function assertContainedVagrantfile(contents: string): void {
  if (/public_network|bridge\s*:/i.test(contents)) {
    throw new Error('The generated lab requests a bridged or public network.');
  }

  const forwardingRules = contents.split(/\r?\n/).filter((line) => /forwarded_port/i.test(line));
  for (const rule of forwardingRules) {
    if (!/host_ip\s*:\s*["']127\.0\.0\.1["']/i.test(rule)) {
      throw new Error('Every forwarded lab port must bind to 127.0.0.1.');
    }
  }
}

export class SecGenService {
  private readonly secgenDirectory: string;
  private readonly projectsDirectory: string;
  private readonly platform: NodeJS.Platform;
  private readonly rubyCommand: string;
  private readonly vagrantCommand: string;
  private readonly now: () => Date;
  private currentProjectDirectory: string | null = null;
  private currentFlags = new Set<string>();
  private vmDestroyed = true;
  private currentScenarioId: string | null = null;

  constructor(options: SecGenServiceOptions) {
    this.platform = options.platform ?? process.platform;
    const pathApi = this.platform === 'win32' ? path.win32 : path.posix;
    this.secgenDirectory = pathApi.resolve(options.secgenDirectory);
    this.projectsDirectory = pathApi.resolve(
      options.projectsDirectory ?? pathApi.join(this.secgenDirectory, 'projects'),
    );
    this.rubyCommand = options.rubyCommand
      ?? (this.platform === 'win32' ? 'ruby.exe' : 'ruby');
    this.vagrantCommand = options.vagrantCommand ?? 'vagrant';
    this.now = options.now ?? (() => new Date());
  }

  async validatePrerequisites(): Promise<SecGenPrerequisiteStatus> {
    const errors: string[] = [];
    try {
      await access(path.join(this.secgenDirectory, 'secgen.rb'));
    } catch {
      errors.push(`SecGen entrypoint not found in ${this.secgenDirectory}.`);
    }

    for (const [command, args] of [
      [this.rubyCommand, ['--version']],
      [this.vagrantCommand, ['--version']],
    ] as const) {
      try {
        await runCommand(command, [...args], { cwd: this.secgenDirectory });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async restoreProject(): Promise<string | null> {
    let contents: string;
    try {
      contents = await readFile(path.join(this.projectsDirectory, '.pwnstore-active.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const state: unknown = JSON.parse(contents);
    if (!state || typeof state !== 'object' || !('scenarioId' in state) || typeof state.scenarioId !== 'string'
      || !state.scenarioId || !('projectDirectory' in state) || typeof state.projectDirectory !== 'string'
      || !('vmDestroyed' in state) || typeof state.vmDestroyed !== 'boolean'
      || path.dirname(state.projectDirectory) !== this.projectsDirectory
      || !/^SecGen_[a-z0-9-]+$/i.test(path.basename(state.projectDirectory))) {
      throw new Error('Invalid saved lab state. Resolve the saved project state before launching another lab.');
    }
    this.currentProjectDirectory = state.projectDirectory;
    this.currentScenarioId = state.scenarioId;
    this.vmDestroyed = state.vmDestroyed;
    return state.scenarioId;
  }

  async generateScenario(scenarioPath: string, scenarioId: string): Promise<SecGenScenario> {
    if (this.currentProjectDirectory) throw new Error('Clean up the previous lab before generating another.');
    const absoluteScenarioPath = path.resolve(scenarioPath);
    const timestamp = this.now().toISOString();
    const projectDirectory = getSecGenProjectPath(
      this.projectsDirectory,
      `${timestamp}-${randomUUID()}`,
      this.platform,
    );
    const outputXmlPath = path.join(projectDirectory, 'scenario.xml');
    const flagsPath = path.join(projectDirectory, 'flag_hints.xml');

    this.currentProjectDirectory = projectDirectory;
    this.currentScenarioId = scenarioId;
    this.currentFlags.clear();
    this.vmDestroyed = true;
    await this.saveProjectState();
    const inputXml = await readFile(absoluteScenarioPath, 'utf8');
    parseScenarioXml(inputXml);
    await runCommand(
      this.rubyCommand,
      [
        path.join(this.secgenDirectory, 'secgen.rb'),
        '-s',
        absoluteScenarioPath,
        '-o',
        projectDirectory,
      ],
      { cwd: this.secgenDirectory },
    );

    const [generatedXml, flagHintsXml] = await Promise.all([
      readFile(outputXmlPath, 'utf8'),
      readFile(flagsPath, 'utf8'),
    ]);
    const scenario = parseScenarioXml(generatedXml);
    const parsedHints = xmlParser.parse(flagHintsXml) as unknown;
    const flags = new Set<string>();
    extractFlagValues(parsedHints, flags);

    this.currentFlags = flags;
    return {
      ...scenario,
      projectDirectory,
      generatedAt: timestamp,
    };
  }

  async startTargetLab(): Promise<void> {
    const projectDirectory = this.requireCurrentProject();
    const vagrantfile = await readFile(path.join(projectDirectory, 'Vagrantfile'), 'utf8');
    assertContainedVagrantfile(vagrantfile);
    this.vmDestroyed = false;
    await this.saveProjectState();
    await runCommand(this.vagrantCommand, ['up'], { cwd: projectDirectory });
  }

  async stopTargetLab(): Promise<void> {
    const projectDirectory = this.requireCurrentProject();
    if (!this.vmDestroyed) {
      await runCommand(this.vagrantCommand, ['destroy', '-f'], { cwd: projectDirectory });
      this.vmDestroyed = true;
    }
    await this.saveProjectState();
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(path.join(this.projectsDirectory, '.pwnstore-active.json'), { force: true });
    this.currentProjectDirectory = null;
    this.currentScenarioId = null;
    this.currentFlags.clear();
  }

  private async saveProjectState(): Promise<void> {
    await mkdir(this.projectsDirectory, { recursive: true });
    const statePath = path.join(this.projectsDirectory, '.pwnstore-active.json');
    const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify({
        scenarioId: this.currentScenarioId,
        projectDirectory: this.currentProjectDirectory,
        vmDestroyed: this.vmDestroyed,
      }), 'utf8');
      await rename(temporaryPath, statePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  verifyFlag(submittedFlag: string): boolean {
    const normalizedSubmission = submittedFlag.trim();
    if (!normalizedSubmission) return false;
    return [...this.currentFlags].some((flag) => flag === normalizedSubmission);
  }

  private requireCurrentProject(): string {
    if (!this.currentProjectDirectory) {
      throw new Error('Generate a SecGen scenario before managing its target lab.');
    }
    return this.currentProjectDirectory;
  }
}
