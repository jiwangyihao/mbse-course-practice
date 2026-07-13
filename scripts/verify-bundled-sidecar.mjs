import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    parsed[current.slice(2)] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

function platformExecutableSuffix(filePath) {
  return filePath.endsWith('.exe') ? '.exe' : '';
}

function shouldForwardEnvKey(key) {
  return [
    'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'HOME',
    'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'PROGRAMDATA',
  ].includes(key)
    || key.startsWith('OMP_')
    || key.startsWith('OPENAI_')
    || key.startsWith('ANTHROPIC_')
    || key.startsWith('GOOGLE_')
    || key.startsWith('GEMINI_')
    || key.startsWith('AZURE_OPENAI_');
}

function inheritedSandboxEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => shouldForwardEnvKey(key)));
}

async function sendRequest(io, closePromise, payload, timeoutMs = 120_000) {
  io.stdin.write(`${JSON.stringify(payload)}\n`);
  const responsePromise = new Promise((resolve, reject) => {
    const onLine = (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.event) {
          return;
        }
        io.stdout.off('line', onLine);
        if (parsed.ok === false) {
          reject(new Error(parsed.error ?? 'sidecar request failed'));
          return;
        }
        resolve(parsed);
      } catch (error) {
        io.stdout.off('line', onLine);
        reject(error);
      }
    };
    io.stdout.on('line', onLine);
  });
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`sidecar request timed out: ${JSON.stringify(payload)}`)), timeoutMs);
  });
  const closedPromise = closePromise.then(({ code, signal }) => {
    throw new Error(`sidecar exited before responding: code=${code} signal=${signal} payload=${JSON.stringify(payload)}`);
  });
  return await Promise.race([responsePromise, timeoutPromise, closedPromise]);
}

async function assertBundledReferenceLayout(resourceRoot) {
  await Promise.all([
    stat(path.join(resourceRoot, 'references', 'example-source-set', 'model.sysml')),
    stat(path.join(resourceRoot, 'references', 'example-source-set', 'requirements.sysml')),
    stat(path.join(resourceRoot, 'references', 'example-source-set', 'structure.sysml')),
    stat(path.join(resourceRoot, 'references', 'example-source-set', 'behavior.sysml')),
    stat(path.join(resourceRoot, 'references', 'example-source-set', 'constraints.sysml')),
    stat(path.join(resourceRoot, 'references', 'example-derived-view-model.json')),
  ]);
}
export async function verifyBundledSidecar({ sidecarPath, resourceRoot, sysml2Path }) {
  await Promise.all([stat(sidecarPath), stat(resourceRoot), stat(sysml2Path), assertBundledReferenceLayout(resourceRoot)]);
  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-bundled-sidecar-'));
  const sandboxSidecarPath = path.join(sandboxRoot, path.basename(sidecarPath));
  const sandboxResourceRoot = path.join(sandboxRoot, 'resources', 'mbse-sidecar');
  const sandboxSysml2Path = path.join(sandboxResourceRoot, 'sysml2', path.basename(path.dirname(sysml2Path)), path.basename(sysml2Path));
  await cp(sidecarPath, sandboxSidecarPath);
  await cp(resourceRoot, sandboxResourceRoot, { recursive: true });
  await stat(sandboxSysml2Path);

  const child = spawn(sandboxSidecarPath, {
    cwd: sandboxRoot,
    env: {
      ...inheritedSandboxEnv(),
      MBSE_AGENT_RESOURCE_ROOT: sandboxResourceRoot,
      MBSE_SYSML2_BIN: sandboxSysml2Path,
      XDG_DATA_HOME: path.join(sandboxResourceRoot, 'runtime-data'),
      NODE_PATH: '',
      BUN_INSTALL: '',
    },
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });

  const readline = await import('node:readline');
  const stdout = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const io = { stdin: child.stdin, stdout };
  const closePromise = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  try {
    const preflight = await sendRequest(io, closePromise, { action: 'preflight' });
    const verification = await sendRequest(io, closePromise, { action: 'verify-workspace-fixture' });
    await sendRequest(io, closePromise, { action: 'shutdown' }, 15_000);
    return {
      sandboxRoot,
      preflight: preflight.status,
      verification: verification.verification,
    };
  } finally {
    stdout.close();
    child.stdin.destroy();
    await closePromise;
    await rm(sandboxRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const srcTauriRoot = path.join(repoRoot, 'src-tauri');
  const manifestPath = path.join(srcTauriRoot, 'resources', 'mbse-sidecar', 'bundle-manifest.json');
  const manifestText = await readFile(manifestPath, 'utf8').catch(() => null);
  const manifest = manifestText ? JSON.parse(manifestText) : null;
  const sidecarPath = args.sidecar ?? (manifest ? path.join(srcTauriRoot, manifest.sidecarPath) : undefined);
  const resourceRoot = args['resource-root'] ?? (manifest ? path.join(srcTauriRoot, manifest.resourceRoot) : path.join(srcTauriRoot, 'resources', 'mbse-sidecar'));
  const resolvedSysml2Path = args.sysml2 ?? (manifest ? path.join(srcTauriRoot, manifest.sysml2Path) : undefined);
  if (!sidecarPath || !resolvedSysml2Path) {
    throw new Error('缺少 sidecar 或 sysml2 路径；请先运行 bundle:prepare 或显式传入 --sidecar / --sysml2。');
  }
  const result = await verifyBundledSidecar({
    sidecarPath,
    resourceRoot,
    sysml2Path: resolvedSysml2Path,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
