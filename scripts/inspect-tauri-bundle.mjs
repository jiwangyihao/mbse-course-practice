import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBundledSidecar } from './verify-bundled-sidecar.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleRoot = path.join(repoRoot, 'src-tauri', 'target', 'release', 'bundle');
const appExecutableName = process.platform === 'win32' ? 'mbse-course-practice.exe' : 'mbse-course-practice';
const sidecarExecutableName = process.platform === 'win32' ? 'mbse-agent-sidecar.exe' : 'mbse-agent-sidecar';
const sysml2ExecutableName = process.platform === 'win32' ? 'sysml2.exe' : 'sysml2';

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with code ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function findFirst(root, predicate) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const current = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFirst(current, predicate);
      if (nested) return nested;
      continue;
    }
    if (predicate(current)) return current;
  }
  return null;
}

async function detectInstaller() {
  const installer = await findFirst(bundleRoot, (filePath) => filePath.endsWith('.exe') && !filePath.endsWith(sidecarExecutableName));
  if (!installer) {
    throw new Error(`未在 ${bundleRoot} 下找到 Windows 安装包。`);
  }
  return installer;
}

async function detectExtractedPaths(extractRoot) {
  const appExe = await findFirst(extractRoot, (filePath) => path.basename(filePath) === appExecutableName);
  if (!appExe) {
    throw new Error(`未在解包目录 ${extractRoot} 中找到应用主程序 ${appExecutableName}。`);
  }
  const executableDir = path.dirname(appExe);
  const resourceRoot = path.join(executableDir, 'mbse-sidecar');
  const sysml2Dir = path.join(resourceRoot, 'sysml2');
  const sysml2Path = await findFirst(sysml2Dir, (filePath) => path.basename(filePath) === sysml2ExecutableName);
  if (!sysml2Path) {
    throw new Error(`未在解包资源中找到 ${sysml2ExecutableName}。`);
  }
  return {
    appExe,
    sidecarExe: path.join(executableDir, sidecarExecutableName),
    resourceRoot,
    sysml2Path,
  };
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('inspect-tauri-bundle.mjs 当前仅支持 Windows NSIS 安装包验证。');
  }
  const installer = await detectInstaller();
  const extractRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-tauri-extract-'));
  try {
    await run('7z', ['x', installer, `-o${extractRoot}`, '-y']);
    const extracted = await detectExtractedPaths(extractRoot);
    await Promise.all([
      stat(extracted.sidecarExe),
      stat(extracted.resourceRoot),
      stat(extracted.sysml2Path),
    ]);
    const sidecarVerification = await verifyBundledSidecar({
      sidecarPath: extracted.sidecarExe,
      resourceRoot: extracted.resourceRoot,
      sysml2Path: extracted.sysml2Path,
    });
    console.log(JSON.stringify({ installer, extractRoot, extracted, sidecarVerification }, null, 2));
  } finally {
    await rm(extractRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

await main();
