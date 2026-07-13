import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SYSML2_TIMEOUT_MS = 120_000;
const SYSML2_SOURCE_RELATIVE_PATH = path.join('tools', 'sysml2');
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;
const OVERLAY_IGNORED_DIRS = new Set(['.git', 'node_modules', 'target', 'dist']);

export class Sysml2BackendUnavailableError extends Error {}

let executablePromise;

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function sysml2SourceRoot() {
  return path.join(repoRoot(), SYSML2_SOURCE_RELATIVE_PATH);
}

function sysml2ExecutableName() {
  return process.platform === 'win32' ? 'sysml2.exe' : 'sysml2';
}

function stripAnsi(text) {
  return String(text ?? '').replace(ANSI_PATTERN, '').replace(/\r/g, '');
}

async function hashTree(root, relativePath, hash) {
  const absolutePath = path.join(root, relativePath);
  const stats = await stat(absolutePath);
  hash.update(relativePath);
  hash.update(String(stats.size));
  hash.update(String(Math.trunc(stats.mtimeMs)));
  if (!stats.isDirectory()) {
    return;
  }
  const entries = (await readdir(absolutePath, { withFileTypes: true }))
    .filter((entry) => entry.name !== '.git')
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    await hashTree(root, path.join(relativePath, entry.name), hash);
  }
}

async function computeBuildKey(sourceRoot) {
  const hash = createHash('sha1');
  for (const entry of ['CMakeLists.txt', 'include', 'src', 'grammar']) {
    await hashTree(sourceRoot, entry, hash);
  }
  return hash.digest('hex').slice(0, 16);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} 超时 (${timeoutMs}ms)`));
        return;
      }
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

async function resolveBundledExecutable() {
  if (process.env.MBSE_SYSML2_BIN) {
    return process.env.MBSE_SYSML2_BIN;
  }

  const sourceRoot = sysml2SourceRoot();
  try {
    await access(path.join(sourceRoot, 'CMakeLists.txt'));
  } catch {
    throw new Sysml2BackendUnavailableError(`主仓库中未找到 vendored sysml2 源码：${sourceRoot}`);
  }

  const buildKey = await computeBuildKey(sourceRoot);
  const cacheRoot = path.join(os.tmpdir(), 'mbse-sysml2-cache', buildKey);
  const buildRoot = path.join(cacheRoot, 'build');
  const executable = path.join(buildRoot, sysml2ExecutableName());
  if (await fileExists(executable)) {
    return executable;
  }

  await mkdir(cacheRoot, { recursive: true });
  const lockRoot = path.join(cacheRoot, 'build.lock');
  const deadline = Date.now() + SYSML2_TIMEOUT_MS;
  while (true) {
    try {
      await mkdir(lockRoot);
      break;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
      if (await fileExists(executable)) {
        return executable;
      }
      if (Date.now() >= deadline) {
        throw new Error(`等待其他进程构建 sysml2 超时：${executable}`);
      }
      await sleep(250);
    }
  }

  try {
    if (await fileExists(executable)) {
      return executable;
    }

    const configureArgs = ['-S', sourceRoot, '-B', buildRoot, '-DCMAKE_BUILD_TYPE=Debug', '-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF'];
    if (process.platform === 'win32' && !process.env.CMAKE_GENERATOR) {
      configureArgs.push('-G', 'MinGW Makefiles');
    }

    let configureResult;
    try {
      configureResult = await runCommand('cmake', configureArgs, {
        cwd: cacheRoot,
        timeoutMs: SYSML2_TIMEOUT_MS,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Sysml2BackendUnavailableError('当前环境缺少 cmake，无法构建 vendored sysml2。');
      }
      throw error;
    }
    if (configureResult.code !== 0) {
      throw new Error(`sysml2 配置失败：\n${stripAnsi(configureResult.stderr || configureResult.stdout)}`);
    }

    let buildResult;
    try {
      buildResult = await runCommand('cmake', ['--build', buildRoot, '--target', 'sysml2'], {
        cwd: cacheRoot,
        timeoutMs: SYSML2_TIMEOUT_MS,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw new Sysml2BackendUnavailableError('当前环境缺少 cmake，无法构建 vendored sysml2。');
      }
      throw error;
    }
    if (buildResult.code !== 0) {
      throw new Error(`sysml2 构建失败：\n${stripAnsi(buildResult.stderr || buildResult.stdout)}`);
    }

    if (!(await fileExists(executable))) {
      throw new Error(`sysml2 构建完成但未产出可执行文件：${executable}`);
    }
    return executable;
  } finally {
    await rm(lockRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function getExecutable() {
  if (!executablePromise) {
    executablePromise = resolveBundledExecutable().catch((error) => {
      executablePromise = undefined;
      throw error;
    });
  }
  return executablePromise;
}

function dedupeDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((diagnostic) => {
    const key = [diagnostic.severity, diagnostic.line, diagnostic.column, diagnostic.message].join('|');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parseSysml2Diagnostics(stderr, filePath) {
  const text = stripAnsi(stderr);
  const diagnostics = [];
  const lines = text.split('\n');
  const primaryPattern = /^(.*?):(\d+):(\d+):\s+(error|warning|note)(?:\[[^\]]+\])?:\s+(.*)$/;
  const notePattern = /^\s*=\s*note:\s+(.*)$/;

  for (const line of lines) {
    const primary = line.match(primaryPattern);
    if (primary) {
      const [, diagnosticPath, lineText, columnText, severityText, message] = primary;
      if (severityText === 'note') {
        if (diagnostics.length > 0) {
          diagnostics[diagnostics.length - 1].message += ` (${message.trim()})`;
        }
        continue;
      }
      diagnostics.push({
        severity: severityText === 'warning' ? 2 : 1,
        message: message.trim(),
        source: 'sysml2',
        line: Number(lineText),
        column: Number(columnText),
        filePath: diagnosticPath,
      });
      continue;
    }

    const note = line.match(notePattern);
    if (note && diagnostics.length > 0) {
      diagnostics[diagnostics.length - 1].message += ` (${note[1].trim()})`;
    }
  }

  if (diagnostics.length > 0) {
    return dedupeDiagnostics(
      diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        message: diagnostic.message,
        source: diagnostic.source,
        line: diagnostic.line,
        column: diagnostic.column,
        filePath: diagnostic.filePath || filePath,
      })),
    );
  }

  const fallbackMessage = text.trim();
  if (!fallbackMessage) {
    return [];
  }
  return [
    {
      severity: 1,
      message: fallbackMessage,
      source: 'sysml2',
      line: 1,
      column: 1,
      filePath,
    },
  ];
}

function splitJsonDocuments(stdout) {
  const docs = [];
  let offset = 0;
  while (offset < stdout.length) {
    while (offset < stdout.length && /\s/.test(stdout[offset])) offset += 1;
    if (offset >= stdout.length) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let index = offset; index < stdout.length; index += 1) {
      const char = stdout[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }

    if (end < 0) {
      throw new Error('sysml2 返回了无法切分的 JSON 输出。');
    }
    docs.push(JSON.parse(stdout.slice(offset, end)));
    offset = end;
  }
  return docs;
}
function isInsideRoot(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function externalOverlayRelativePath(originalFilePath) {
  const digest = createHash('sha1').update(originalFilePath).digest('hex').slice(0, 12);
  return path.join('__mbse_external_target__', `${digest}-${path.basename(originalFilePath)}`);
}

async function copySysmlWorkspaceFiles(sourceRoot, overlayRoot, currentRelativePath = '', skippedRelativePath = null) {
  const entries = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => !OVERLAY_IGNORED_DIRS.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath = currentRelativePath ? path.join(currentRelativePath, entry.name) : entry.name;
    const sourcePath = path.join(sourceRoot, entry.name);

    if (entry.isDirectory()) {
      await copySysmlWorkspaceFiles(sourcePath, overlayRoot, relativePath, skippedRelativePath);
      continue;
    }

    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.sysml') {
      continue;
    }
    if (skippedRelativePath && relativePath === skippedRelativePath) {
      continue;
    }

    const overlayPath = path.join(overlayRoot, relativePath);
    await mkdir(path.dirname(overlayPath), { recursive: true });
    await copyFile(sourcePath, overlayPath);
  }
}

async function createOverlayInvocation({ workspaceRoot, filePath, text }) {
  if (typeof text !== 'string') {
    return null;
  }

  const originalWorkspaceRoot = path.resolve(workspaceRoot);
  const originalFilePath = path.resolve(filePath);
  const overlayRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-sysml2-overlay-'));

  try {
    const targetInsideWorkspaceRoot = isInsideRoot(originalWorkspaceRoot, originalFilePath);
    const fileRelativePath = targetInsideWorkspaceRoot
      ? path.relative(originalWorkspaceRoot, originalFilePath)
      : externalOverlayRelativePath(originalFilePath);

    await copySysmlWorkspaceFiles(originalWorkspaceRoot, overlayRoot, '', targetInsideWorkspaceRoot ? fileRelativePath : null);

    const overlayFilePath = path.join(overlayRoot, fileRelativePath);
    await mkdir(path.dirname(overlayFilePath), { recursive: true });
    await writeFile(overlayFilePath, text, 'utf8');

    return {
      overlayRoot,
      overlayFilePath,
      overlayTargetPathMap: new Map([[path.resolve(overlayFilePath), originalFilePath]]),
      originalWorkspaceRoot,
      originalFilePath,
    };
  } catch (error) {
    await rm(overlayRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw error;
  }
}

function rewriteOverlayPathValue(filePath, overlay) {
  if (!overlay || typeof filePath !== 'string' || filePath.trim() === '') {
    return filePath;
  }

  const resolvedPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(overlay.overlayRoot, filePath);
  const mappedTargetPath = overlay.overlayTargetPathMap?.get(resolvedPath);
  if (mappedTargetPath) {
    return mappedTargetPath;
  }
  if (!isInsideRoot(overlay.overlayRoot, resolvedPath)) {
    return filePath;
  }

  const relativePath = path.relative(overlay.overlayRoot, resolvedPath);
  return path.join(overlay.originalWorkspaceRoot, relativePath);
}

function rewriteOverlayDiagnostics(diagnostics, overlay) {
  if (!overlay) {
    return diagnostics;
  }

  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    filePath: rewriteOverlayPathValue(diagnostic.filePath, overlay),
  }));
}

function rewriteOverlayDocuments(semanticDocuments, overlay) {
  if (!overlay) {
    return semanticDocuments;
  }

  return semanticDocuments.map((document) => {
    if (typeof document?.meta?.source !== 'string') {
      return document;
    }
    return {
      ...document,
      meta: {
        ...document.meta,
        source: rewriteOverlayPathValue(document.meta.source, overlay),
      },
    };
  });
}

export async function runSysml2Analysis({ workspaceRoot, filePath, text, timeoutMs = 30_000, select = [] }) {
  const executable = await getExecutable();
  const overlay = await createOverlayInvocation({ workspaceRoot, filePath, text });
  const invocationWorkspaceRoot = overlay?.overlayRoot ?? path.resolve(workspaceRoot);
  const invocationFilePath = overlay?.overlayFilePath ?? path.resolve(filePath);
  const args = ['--color=never', '-f', 'json', '-I', invocationWorkspaceRoot];
  for (const pattern of select) {
    args.push('-s', pattern);
  }
  args.push(invocationFilePath);

  try {
    const result = await runCommand(executable, args, {
      cwd: invocationWorkspaceRoot,
      timeoutMs,
    });
    let diagnostics = parseSysml2Diagnostics(result.stderr, invocationFilePath);
    const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity <= 2);
    let semanticDocuments = result.stdout.trim() ? splitJsonDocuments(result.stdout) : [];

    diagnostics = rewriteOverlayDiagnostics(diagnostics, overlay);
    semanticDocuments = rewriteOverlayDocuments(semanticDocuments, overlay);

    return {
      valid: result.code === 0 && blockingDiagnostics.length === 0,
      diagnostics,
      backend: 'sysml2',
      semanticDocuments,
      exitCode: result.code,
    };
  } finally {
    if (overlay) {
      await rm(overlay.overlayRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}

export async function validateSysmlWithSysml2({ workspaceRoot, filePath, text, timeoutMs = 30_000 }) {
  const analysis = await runSysml2Analysis({ workspaceRoot, filePath, text, timeoutMs });
  return {
    valid: analysis.valid,
    diagnostics: analysis.diagnostics,
    backend: analysis.backend,
  };
}
