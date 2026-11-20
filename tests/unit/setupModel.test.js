import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupModel } from '../../scripts/setup-model.mjs';

const filename = 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf';
const contents = 'test model';
const expectedSha256 = createHash('sha256').update(contents).digest('hex');
const directories = [];

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pwnstore-model-test-'));
  directories.push(directory);
  return {
    directory,
    expectedSha256,
    fetchImpl: vi.fn().mockResolvedValue(new Response(contents)),
    runDocker: vi.fn().mockResolvedValue('{"data":[]}'),
    log: vi.fn(),
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('project model setup', () => {
  it('downloads, verifies and imports the model from the project directory', async () => {
    const options = await setup();
    options.runDocker
      .mockResolvedValueOnce('{"data":[]}')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('{"data":[{"id":"huggingface.co/qwen/qwen2.5-coder-1.5b-instruct-gguf:latest"}]}');
    await setupModel(options);
    const modelPath = path.join(options.directory, filename);
    expect(await readFile(modelPath, 'utf8')).toBe(contents);
    expect(options.runDocker).toHaveBeenCalledWith([
      'model', 'package', '--gguf', modelPath, 'hf.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF',
    ]);
  });

  it('reports an import that Docker claims succeeded but does not list', async () => {
    const options = await setup();
    await expect(setupModel(options)).rejects.toThrow('model is not available');
    expect(await readFile(path.join(options.directory, filename), 'utf8')).toBe(contents);
  });

  it('reuses the verified file and does not replace an installed model', async () => {
    const options = await setup();
    await writeFile(path.join(options.directory, filename), contents);
    options.runDocker.mockResolvedValue('{"data":[{"id":"huggingface.co/qwen/qwen2.5-coder-1.5b-instruct-gguf:latest"}]}');
    await setupModel(options);
    expect(options.fetchImpl).not.toHaveBeenCalled();
    expect(options.runDocker).toHaveBeenCalledTimes(1);
  });

  it('rejects corrupt downloads and removes the incomplete file', async () => {
    const options = await setup();
    options.fetchImpl.mockResolvedValue(new Response('incorrect'));
    await expect(setupModel(options)).rejects.toThrow('checksum');
    expect(await readdir(options.directory)).toEqual([]);
    expect(options.runDocker).not.toHaveBeenCalled();
  });

  it('does not replace an existing invalid model file', async () => {
    const options = await setup();
    const modelPath = path.join(options.directory, filename);
    await writeFile(modelPath, 'incorrect');
    await expect(setupModel(options)).rejects.toThrow('unexpected SHA-256');
    expect(await readFile(modelPath, 'utf8')).toBe('incorrect');
    expect(options.fetchImpl).not.toHaveBeenCalled();
  });
});
