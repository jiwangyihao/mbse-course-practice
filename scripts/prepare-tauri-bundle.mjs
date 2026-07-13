import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcTauriRoot = path.join(repoRoot, 'src-tauri');
const bundleBinDir = path.join(srcTauriRoot, 'bin');
const bundleResourceRoot = path.join(srcTauriRoot, 'resources', 'mbse-sidecar');
const sysml2SourceRoot = path.join(repoRoot, 'tools', 'sysml2');
const buildRoot = path.join(repoRoot, 'build', 'tauri-bundle');

const referenceFiles = [
  ['sidecar/references/WORKBENCH_MODELING_GUIDE.md', 'references/WORKBENCH_MODELING_GUIDE.md'],
  ['sidecar/references/VIEW_MODEL_CONTRACT.md', 'references/VIEW_MODEL_CONTRACT.md'],
  ['sample-projects/tianwen-2/model/tianwen-2.sysml', 'references/example-model.sysml'],
  ['sample-projects/tianwen-2/model/view-model.json', 'references/example-view-model.json'],
  ['docs/adr/0003-sysml-v2-and-json-view-model.md', 'references/adr-sysml-view-model.md'],
  ['docs/adr/0008-expanded-view-set.md', 'references/adr-expanded-view-set.md'],
  ['docs/adr/0009-static-validation-for-ibd-param.md', 'references/adr-static-validation.md'],
];

function platformExecutableSuffix(targetTriple) {
  return targetTriple.includes('windows') ? '.exe' : '';
}

function nativePlatformTag(targetTriple) {
  if (targetTriple.includes('windows') && targetTriple.includes('x86_64')) return 'win32-x64';
  if (targetTriple.includes('linux') && targetTriple.includes('x86_64')) return 'linux-x64';
  if (targetTriple.includes('linux') && targetTriple.includes('aarch64')) return 'linux-arm64';
  if (targetTriple.includes('darwin') && targetTriple.includes('x86_64')) return 'darwin-x64';
  if (targetTriple.includes('darwin') && targetTriple.includes('aarch64')) return 'darwin-arm64';
  throw new Error(`未支持的 pi_natives 平台：${targetTriple}`);
}

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

async function detectTargetTriple() {
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;
  if (process.env.CARGO_BUILD_TARGET) return process.env.CARGO_BUILD_TARGET;
  const { stdout } = await run('rustc', ['-vV']);
  const hostLine = stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('host: '));
  if (!hostLine) {
    throw new Error(`unable to detect rust target triple from rustc -vV output:\n${stdout}`);
  }
  return hostLine.slice('host: '.length).trim();
}

async function ensureCleanDir(dir) {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir(dir, { recursive: true });
}

async function buildSidecarBinary(targetTriple) {
  const outputPath = path.join(bundleBinDir, `mbse-agent-sidecar-${targetTriple}${platformExecutableSuffix(targetTriple)}`);
  const args = [
    'build',
    path.join('sidecar', 'agent-sdk-sidecar.mjs'),
    '--compile',
    '--target=bun',
    `--outfile=${outputPath}`,
    '--no-compile-autoload-dotenv',
    '--no-compile-autoload-bunfig',
    '--no-compile-autoload-package-json',
    '--no-compile-autoload-tsconfig',
  ];
  if (targetTriple.includes('windows')) {
    args.push('--windows-hide-console');
    args.push('--windows-title=MBSE Agent Sidecar');
    args.push('--windows-description=Bundled MBSE Agent Sidecar');
  }
  await run('bun', args, { cwd: repoRoot });
  await stat(outputPath);
  return outputPath;
}

async function buildSysml2Binary(targetTriple) {
  const buildDir = path.join(buildRoot, 'sysml2', targetTriple);
  await ensureCleanDir(buildDir);
  const configureArgs = [
    '-S',
    sysml2SourceRoot,
    '-B',
    buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF',
  ];
  if (process.platform === 'win32' && !process.env.CMAKE_GENERATOR) {
    configureArgs.push('-G', 'MinGW Makefiles');
  }
  await run('cmake', configureArgs, { cwd: repoRoot });
  await run('cmake', ['--build', buildDir, '--target', 'sysml2'], { cwd: repoRoot });
  const builtBinary = path.join(buildDir, `sysml2${platformExecutableSuffix(targetTriple)}`);
  await stat(builtBinary);
  const bundledBinary = path.join(bundleResourceRoot, 'sysml2', targetTriple, `sysml2${platformExecutableSuffix(targetTriple)}`);
  await mkdir(path.dirname(bundledBinary), { recursive: true });
  await copyFile(builtBinary, bundledBinary);
  return bundledBinary;
}

async function copyReferences() {
  for (const [relativeSource, relativeTarget] of referenceFiles) {
    const source = path.join(repoRoot, relativeSource);
    const target = path.join(bundleResourceRoot, relativeTarget);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

async function copyNativeAddons(targetTriple) {
  const piNativesManifest = JSON.parse(await readFile(path.join(repoRoot, 'node_modules', '@oh-my-pi', 'pi-natives', 'package.json'), 'utf8'));
  const packageVersion = piNativesManifest.version;
  const platformTag = nativePlatformTag(targetTriple);
  const packageDir = path.join(repoRoot, 'node_modules', '@oh-my-pi', `pi-natives-${platformTag}`);
  const destinationDir = path.join(bundleResourceRoot, 'runtime-data', 'omp', 'natives', packageVersion);
  await mkdir(destinationDir, { recursive: true });
  for (const entry of await readdir(packageDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.node')) continue;
    await copyFile(path.join(packageDir, entry.name), path.join(destinationDir, entry.name));
  }
  return { packageVersion, destinationDir, platformTag };
}

async function writeManifest(targetTriple, sidecarPath, sysml2Path, nativeAddonInfo) {
  const manifest = {
    targetTriple,
    sidecarPath: path.relative(srcTauriRoot, sidecarPath),
    resourceRoot: path.relative(srcTauriRoot, bundleResourceRoot),
    sysml2Path: path.relative(srcTauriRoot, sysml2Path),
    nativeAddons: nativeAddonInfo,
    references: Object.fromEntries(referenceFiles),
  };
  const manifestPath = path.join(bundleResourceRoot, 'bundle-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

async function main() {
  const targetTriple = await detectTargetTriple();
  await mkdir(bundleBinDir, { recursive: true });
  await ensureCleanDir(bundleResourceRoot);
  const [sidecarPath, sysml2Path] = await Promise.all([
    buildSidecarBinary(targetTriple),
    buildSysml2Binary(targetTriple),
  ]);
  await copyReferences();
  const nativeAddonInfo = await copyNativeAddons(targetTriple);
  const manifestPath = await writeManifest(targetTriple, sidecarPath, sysml2Path, nativeAddonInfo);
  console.log(JSON.stringify({
    targetTriple,
    sidecarPath,
    sysml2Path,
    bundleResourceRoot,
    nativeAddonInfo,
    manifestPath,
  }, null, 2));
}

await main();
