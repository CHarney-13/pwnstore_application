import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const MODEL = 'hf.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF';
const FILENAME = 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf';
const SHA256 = 'cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046';
const URL = `https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/${FILENAME}`;
const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

async function checksum(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function normalizedName(name) {
  return name.toLowerCase().replace(/^hf\.co\//, 'huggingface.co/');
}

async function modelIsInstalled(runDocker) {
  const parsed = JSON.parse(await runDocker(['model', 'list', '--openai']));
  if (!parsed || !Array.isArray(parsed.data)) throw new Error('Unexpected docker model list output.');
  const modelName = normalizedName(MODEL);
  return parsed.data.some((item) => {
    if (!item || typeof item.id !== 'string') return false;
    const id = normalizedName(item.id);
    return id === modelName || id.startsWith(`${modelName}:`);
  });
}

export async function setupModel({
  directory = path.join(PROJECT_DIR, 'models'),
  fetchImpl = globalThis.fetch,
  runDocker = async (args) => (await execFileAsync('docker', args, { windowsHide: true })).stdout,
  expectedSha256 = SHA256,
  log = console.log,
} = {}) {
  const destination = path.join(directory, FILENAME);
  await mkdir(directory, { recursive: true });

  let exists = true;
  try {
    await access(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    exists = false;
  }

  if (!exists) {
    log(`Downloading ${FILENAME} to ${directory}...`);
    const temporaryDirectory = await mkdtemp(path.join(directory, '.qwen-download-'));
    try {
      const temporaryFile = path.join(temporaryDirectory, FILENAME);
      const response = await fetchImpl(URL);
      if (!response.ok || !response.body) {
        throw new Error(`Model download failed with HTTP ${response.status}.`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryFile, { flags: 'wx' }));
      if (await checksum(temporaryFile) !== expectedSha256) {
        throw new Error('Downloaded model checksum does not match the expected SHA-256.');
      }
      await rename(temporaryFile, destination);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  } else if (await checksum(destination) !== expectedSha256) {
    throw new Error(`Model file ${destination} has an unexpected SHA-256. Remove or replace it before retrying.`);
  }

  if (!await modelIsInstalled(runDocker)) {
    log('Importing the model into Docker Model Runner...');
    await runDocker(['model', 'package', '--gguf', destination, MODEL]);
    if (!await modelIsInstalled(runDocker)) {
      throw new Error('Docker Model Runner reported a successful import, but the model is not available. Check docker model logs and retry.');
    }
  }
  log(`Model ready at ${destination}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setupModel().catch((error) => {
    console.error('Model setup failed:', error);
    process.exitCode = 1;
  });
}
