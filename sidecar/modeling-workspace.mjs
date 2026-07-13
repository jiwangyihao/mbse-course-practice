import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { validateViewModel } from '../src/domain/modelGeneration.ts';
import {
  MODEL_SOURCE_SET_ENTRY_FILE,
  MODEL_SOURCE_SET_FILES,
  deriveViewModelFromSemanticDocuments,
  normalizeModelSourceSet,
} from '../src/domain/modelGeneration.node.ts';
import { runSysml2Analysis, validateSysmlWithSysml2 } from './sysml2-backend.mjs';

const OUTPUT_ROOT = 'output';
const OUTPUT_VIEW_MODEL_PATH = 'output/view-model.json';
const PLACEHOLDER_PATTERN = /(?:<[A-Za-z][A-Za-z0-9._-]*>|\bTODO\b|\bplaceholder\b)/i;
const REQUIRED_VIEW_KINDS = ['requirements', 'bdd', 'activity', 'traceability-matrix', 'ibd', 'parameter-constraints'];
const OUTPUT_SOURCE_FILES = Object.freeze(MODEL_SOURCE_SET_FILES.map((file) => path.posix.join(OUTPUT_ROOT, file)));
const BUNDLED_REFERENCE_PATHS = Object.freeze({
  './references/WORKBENCH_MODELING_GUIDE.md': 'references/WORKBENCH_MODELING_GUIDE.md',
  './references/VIEW_MODEL_CONTRACT.md': 'references/VIEW_MODEL_CONTRACT.md',
  '../sample-projects/tianwen-2/model/model.sysml': 'references/example-source-set/model.sysml',
  '../sample-projects/tianwen-2/model/requirements.sysml': 'references/example-source-set/requirements.sysml',
  '../sample-projects/tianwen-2/model/structure.sysml': 'references/example-source-set/structure.sysml',
  '../sample-projects/tianwen-2/model/behavior.sysml': 'references/example-source-set/behavior.sysml',
  '../sample-projects/tianwen-2/model/constraints.sysml': 'references/example-source-set/constraints.sysml',
  '../sample-projects/tianwen-2/model/view-model.json': 'references/example-derived-view-model.json',
  '../docs/adr/0003-sysml-v2-and-json-view-model.md': 'references/adr-sysml-view-model.md',
  '../docs/adr/0008-expanded-view-set.md': 'references/adr-expanded-view-set.md',
  '../docs/adr/0009-static-validation-for-ibd-param.md': 'references/adr-static-validation.md',
});

const VERIFY_PARAMETERS = z.strictObject({});
const YIELD_PARAMETERS = z.strictObject({
  summary: z.string().min(1).describe('执行结果摘要，不包含最终工件正文'),
  actions: z.array(z.string().min(1)).min(1).describe('已执行的主要步骤记录'),
  verificationNotes: z.array(z.string().min(1)).default([]).describe('校验和修正记录'),
});

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function createDiagnostic(code, pathValue, message, hint, severity = 'error') {
  return { severity, code, path: pathValue, message, hint };
}

async function pathExists(candidate) {
  try {
    await lstat(candidate);
    return true;
  } catch {
    return false;
  }
}

async function readWorkspaceFile(workspaceRoot, relativePath) {
  const root = await realpath(workspaceRoot);
  const candidate = path.resolve(root, relativePath);
  if (!isInsideRoot(root, candidate)) {
    throw new Error(`固定输出路径越过工作区根目录：${relativePath}`);
  }
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${relativePath} 必须是工作区内的普通文件，不能是目录、符号链接或 junction。`);
  }
  const resolved = await realpath(candidate);
  if (!isInsideRoot(root, resolved)) {
    throw new Error(`${relativePath} 解析后越过工作区根目录。`);
  }
  return readFile(resolved, 'utf8');
}

async function collectOutputSysmlFiles(outputRoot, currentRelative = '') {
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = currentRelative === '' ? entry.name : path.posix.join(currentRelative, entry.name);
    const absolutePath = path.join(outputRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectOutputSysmlFiles(absolutePath, relativePath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.sysml')) {
      files.push(relativePath.replace(/\\/g, '/'));
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function relativeOutputPath(outputRootAbsolute, absolutePath) {
  const relative = path.relative(outputRootAbsolute, absolutePath).replace(/\\/g, '/');
  return isInsideRoot(outputRootAbsolute, absolutePath) ? path.posix.join(OUTPUT_ROOT, relative) : absolutePath.replace(/\\/g, '/');
}
function absoluteWorkspacePath(workspaceRoot, relativePath) {
  return path.resolve(workspaceRoot, ...relativePath.split('/'));
}


function locateVerificationDiagnostic(diagnostic) {
  const diagnosticPath = typeof diagnostic.path === 'string' ? diagnostic.path : '';
  const sysmlLocation = /^(output\/[^:]+\.sysml)(?::(\d+):(\d+))?$/u.exec(diagnosticPath);
  if (sysmlLocation) {
    return {
      filePath: sysmlLocation[1],
      line: sysmlLocation[2] ? Number(sysmlLocation[2]) : null,
      column: sysmlLocation[3] ? Number(sysmlLocation[3]) : null,
      modelPath: null,
    };
  }
  if (diagnosticPath.startsWith(`${OUTPUT_ROOT}/`) && diagnosticPath.endsWith('.sysml')) {
    return { filePath: diagnosticPath, line: null, column: null, modelPath: null };
  }
  return {
    filePath: path.posix.join(OUTPUT_ROOT, MODEL_SOURCE_SET_ENTRY_FILE),
    line: null,
    column: null,
    modelPath: diagnosticPath || null,
  };
}

function groupVerificationDiagnostics(diagnostics) {
  const groups = new Map();
  for (const diagnostic of diagnostics) {
    const location = locateVerificationDiagnostic(diagnostic);
    const group = groups.get(location.filePath) ?? [];
    group.push({ diagnostic, location });
    groups.set(location.filePath, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function diagnosticEditInstruction(diagnostic, location, workspaceRoot) {
  const absoluteFilePath = absoluteWorkspacePath(workspaceRoot, location.filePath);
  if (diagnostic.code === 'missing-source-file' || diagnostic.code === 'missing-or-unsafe-file') {
    return `调用 write 创建 ${absoluteFilePath}，补充当前 SysML 候选内容，然后再次调用 verify。`;
  }
  if (diagnostic.code === 'unexpected-source-file' || diagnostic.code === 'forbidden-derived-artifact') {
    return `${diagnostic.hint ?? `处理 ${absoluteFilePath}。`} 完成后再次调用 verify。`;
  }
  const position = location.line
    ? `第 ${location.line} 行${location.column ? `第 ${location.column} 列` : ''}`
    : '对应模型声明';
  return `调用 edit 修改 ${absoluteFilePath} 的${position}：${diagnostic.hint ?? '修正该诊断对应的 SysML 内容。'} 修改后再次调用 verify。`;
}

function verificationAffectedFiles(verification) {
  return groupVerificationDiagnostics(verification.diagnostics)
    .map(([filePath]) => filePath);
}

function formatVerification(verification, operation = 'verify', workspaceRoot) {
  const warningCount = verification.diagnostics.filter((item) => item.severity === 'warning').length;
  if (verification.valid) {
    const lines = [
      `${operation === 'yield' ? 'YIELD_RESULT' : 'VERIFY_RESULT'}: PASSED`,
      `工具调用成功；${operation} 参数已被正确接受。`,
      `- SysML 候选文件：${verification.draft?.sourceSet.files.length ?? 0}`,
      `- 派生视图：${verification.draft?.viewModel.views.length ?? 0}`,
      `- 已检查规则：${verification.checkedRules.length}`,
      `- 警告：${warningCount}`,
    ];
    for (const warning of verification.diagnostics.filter((item) => item.severity === 'warning')) {
      const location = locateVerificationDiagnostic(warning);
      lines.push(`- [warning:${warning.code}] ${absoluteWorkspacePath(workspaceRoot, location.filePath)}: ${warning.message}`);
    }
    return lines.join('\n');
  }

  const groups = groupVerificationDiagnostics(verification.diagnostics);
  const affectedFiles = groups.map(([filePath]) => absoluteWorkspacePath(workspaceRoot, filePath));
  const lines = [
    `${operation === 'yield' ? 'YIELD_RESULT: REJECTED_BY_SYSML_VALIDATION' : 'VERIFY_RESULT: INVALID_SYSML'}`,
    `工具调用成功；${operation} 参数已被正确接受。以下内容是 SysML 候选文件校验诊断，不是工具参数错误。不要修改 ${operation} 调用参数。`,
    `需要修改的 SysML 候选文件（${affectedFiles.length}）：${affectedFiles.join('、')}`,
    operation === 'yield'
      ? '下一步：不要重复调用 yield。先使用 read/edit/write 修改下列绝对路径中的 SysML 候选文件，再调用 verify 获取新诊断；verify 通过后才能重新调用 yield。'
      : '下一步：使用 read/edit/write 修改下列绝对路径中的 SysML 候选文件；完成一轮修改后，仍使用空对象参数 {} 再次调用 verify。',
    `诊断总数：${verification.diagnostics.length}`,
  ];
  for (const [filePath, entries] of groups) {
    const absoluteFilePath = absoluteWorkspacePath(workspaceRoot, filePath);
    lines.push('', `文件（绝对路径）：${absoluteFilePath}`, `工作区相对路径：${filePath}`);
    for (const { diagnostic, location } of entries) {
      const position = location.line
        ? `第 ${location.line} 行，第 ${location.column ?? 1} 列`
        : location.modelPath
          ? `派生模型路径 ${location.modelPath}`
          : '整个文件';
      lines.push(
        `- [${diagnostic.severity}:${diagnostic.code}]`,
        `  位置：${position}`,
        `  原因：${diagnostic.message}`,
        `  修改指令：${diagnosticEditInstruction(diagnostic, location, workspaceRoot)}`,
      );
    }
  }
  return lines.join('\n');
}

function resolveReferenceSource(relativeSource) {
  const bundledResourceRoot = process.env.MBSE_AGENT_RESOURCE_ROOT;
  if (typeof bundledResourceRoot === 'string' && bundledResourceRoot.trim() !== '') {
    const bundledRelativePath = BUNDLED_REFERENCE_PATHS[relativeSource];
    if (!bundledRelativePath) {
      throw new Error(`未声明的 bundle 引用资源：${relativeSource}`);
    }
    return path.join(path.resolve(bundledResourceRoot), bundledRelativePath);
  }
  return fileURLToPath(new URL(relativeSource, import.meta.url));
}

async function copyReference(relativeSource, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(resolveReferenceSource(relativeSource), destination);
}

function workspaceReadme(confirmedData, workspaceRoot) {
  return `# Agent 建模工作区

本目录是约定式工作目录，不是操作系统安全沙箱。

## 输入
- input/confirmed-data.json（建模输入事实来源，仅供生成 SysML 时参考）
- input/source-material.md（只供追溯原始语境）

## 参考
- references/WORKBENCH_MODELING_GUIDE.md
- references/VIEW_MODEL_CONTRACT.md
- references/example-source-set/model.sysml
- references/example-source-set/requirements.sysml
- references/example-source-set/structure.sysml
- references/example-source-set/behavior.sysml
- references/example-source-set/constraints.sysml
- references/example-derived-view-model.json（仅供理解派生结果，不得作为最终输出）
- references/adr-sysml-view-model.md
- references/adr-expanded-view-set.md
- references/adr-static-validation.md

## 固定输出
${OUTPUT_SOURCE_FILES.map((file) => `- ${absoluteWorkspacePath(workspaceRoot, file)}（工作区相对路径：${file}）`).join('\n')}

禁止创建 ${absoluteWorkspacePath(workspaceRoot, OUTPUT_VIEW_MODEL_PATH)}；verify/yield 只从 SysML source set 派生 JSON 视图模型，并拒绝残留或伪造的 output/view-model.json。

## 执行策略
- 必须调用 write，把第一版 SysML 分别创建到上述五个绝对路径；不能只在回复、思考、工具参数或 yield 中给出 SysML。
- 后续局部修改调用 edit；需要整体重写时再次调用 write。所有 read/edit/write 的 path 都优先使用上述绝对路径。
- 尽早落盘当前最好的一版 SysML；草案可以不完整、有缺文件或尚未通过校验。
- verify 参数始终是空对象 {}；verify 是发现当前缺口并驱动修改的工具，不是必须先满足全部条件才能调用的门槛。不要在调用 verify 前用自写脚本预判或复刻它。
- eval 只用于短小、增量的表达式或状态检查。较长、多步骤、包含函数或循环的 Python 等脚本应写入 scratch/scripts/，再用短命令执行。
- 中间数据、日志、分析笔记和其他有必要保留的临时文件应分别写入 scratch/data/、scratch/logs/、scratch/notes/；临时文件不得写入 output/。

当前 projectId：${confirmedData.projectId}
当前 packageName：${confirmedData.packageName}

反复调用 verify 修正问题。只有 verify 通过后才能调用 yield；yield 参数只允许执行记录报告。
`;
}

async function verifyWorkspaceOutputs(workspaceRoot) {
  const diagnostics = [];
  const checkedRules = [
    'expected-source-set-files',
    'regular-file-no-symlink',
    'forbid-derived-json-output',
    'no-placeholders',
    'strict-sysml2-per-file',
    'strict-sysml2-entry-analysis',
    'semantic-view-model-derivation',
    'derived-view-model-validation',
  ];
  const rootAbsolute = await realpath(workspaceRoot);
  const outputRootAbsolute = path.join(rootAbsolute, OUTPUT_ROOT);

  if (await pathExists(path.join(rootAbsolute, OUTPUT_VIEW_MODEL_PATH))) {
    diagnostics.push(
      createDiagnostic(
        'forbidden-derived-artifact',
        OUTPUT_VIEW_MODEL_PATH,
        `不允许写入 ${OUTPUT_VIEW_MODEL_PATH}；JSON 视图模型只能由 verify/yield 从 SysML source set 派生。`,
        '删除该文件，只保留约定的 SysML 源文件集合。',
      ),
    );
  }

  const discoveredSysmlFiles = await collectOutputSysmlFiles(outputRootAbsolute);
  const expectedFiles = new Set(MODEL_SOURCE_SET_FILES);
  for (const expected of MODEL_SOURCE_SET_FILES) {
    if (!discoveredSysmlFiles.includes(expected)) {
      diagnostics.push(
        createDiagnostic(
          'missing-source-file',
          path.posix.join(OUTPUT_ROOT, expected),
          `缺少约定的 SysML 源文件：${expected}。`,
          '补齐固定多文件 source set。',
        ),
      );
    }
  }
  for (const discovered of discoveredSysmlFiles) {
    if (!expectedFiles.has(discovered)) {
      diagnostics.push(
        createDiagnostic(
          'unexpected-source-file',
          path.posix.join(OUTPUT_ROOT, discovered),
          `发现未声明的额外 SysML 文件：${discovered}。`,
          '删除额外文件，或把内容整合进固定 source set。',
        ),
      );
    }
  }

  const sourceFiles = [];
  for (const relativeFile of discoveredSysmlFiles) {
    const relativeOutputPath = path.posix.join(OUTPUT_ROOT, relativeFile);
    try {
      const content = await readWorkspaceFile(rootAbsolute, relativeOutputPath);
      sourceFiles.push({ path: relativeFile, content });
      if (content.trim() === '') {
        diagnostics.push(createDiagnostic('empty-sysml', relativeOutputPath, 'SysML 文件为空。', '生成完整有效的 SysML 文本。'));
      }
      if (PLACEHOLDER_PATTERN.test(content)) {
        diagnostics.push(createDiagnostic('placeholder', relativeOutputPath, 'SysML 中仍存在占位符或 TODO。', '替换为真实模型内容。'));
      }
    } catch (error) {
      diagnostics.push(
        createDiagnostic(
          'missing-or-unsafe-file',
          relativeOutputPath,
          error instanceof Error ? error.message : String(error),
          '创建工作区内的普通 .sysml 文件。',
        ),
      );
    }
  }

  const diagnosticKeys = new Set(diagnostics.map((item) => `${item.code}|${item.path}|${item.message}`));
  for (const relativeFile of discoveredSysmlFiles) {
    const absoluteFilePath = path.join(outputRootAbsolute, relativeFile);
    try {
      const validation = await validateSysmlWithSysml2({
        workspaceRoot: outputRootAbsolute,
        filePath: absoluteFilePath,
        timeoutMs: 120_000,
      });
      for (const diagnostic of validation.diagnostics.filter((item) => item.severity <= 2)) {
        const pathValue = `${relativeOutputPath(outputRootAbsolute, diagnostic.filePath)}:${diagnostic.line}:${diagnostic.column}`;
        const severity = diagnostic.severity === 2 && /^Definition '.+' is not referenced by any usage in the workspace$/.test(diagnostic.message)
          ? 'warning'
          : 'error';
        const issue = createDiagnostic('sysml-syntax', pathValue, diagnostic.message, '按 vendored sysml2 诊断修正语法或语义错误。', severity);
        const key = `${issue.code}|${issue.path}|${issue.message}`;
        if (!diagnosticKeys.has(key)) {
          diagnosticKeys.add(key);
          diagnostics.push(issue);
        }
      }
    } catch (error) {
      const issue = createDiagnostic(
        'sysml-backend-unavailable',
        path.posix.join(OUTPUT_ROOT, relativeFile),
        `无法执行 vendored sysml2：${error instanceof Error ? error.message : String(error)}`,
        '修复 sysml2 可执行文件或本地构建链后重新校验。',
      );
      const key = `${issue.code}|${issue.path}|${issue.message}`;
      if (!diagnosticKeys.has(key)) {
        diagnosticKeys.add(key);
        diagnostics.push(issue);
      }
    }
  }

  const hasExpectedSet = MODEL_SOURCE_SET_FILES.every((file) => sourceFiles.some((entry) => entry.path === file));
  if (!hasExpectedSet) {
    return { valid: false, diagnostics, checkedRules };
  }

  const sourceSet = normalizeModelSourceSet({
    rootDir: '',
    entryPath: MODEL_SOURCE_SET_ENTRY_FILE,
    files: sourceFiles.filter((entry) => expectedFiles.has(entry.path)),
  });
  const entryAbsolutePath = path.join(outputRootAbsolute, sourceSet.entryPath);

  let derivedViewModel;
  let derivedValidation;
  try {
    const analysis = await runSysml2Analysis({
      workspaceRoot: outputRootAbsolute,
      filePath: entryAbsolutePath,
      timeoutMs: 120_000,
    });
    for (const diagnostic of analysis.diagnostics.filter((item) => item.severity <= 2)) {
      const pathValue = `${relativeOutputPath(outputRootAbsolute, diagnostic.filePath)}:${diagnostic.line}:${diagnostic.column}`;
      const severity = diagnostic.severity === 2 ? 'warning' : 'error';
      const issue = createDiagnostic('sysml-entry-analysis', pathValue, diagnostic.message, '修正入口文件及其整个 source set 的 strict 诊断。', severity);
      const key = `${issue.code}|${issue.path}|${issue.message}`;
      if (!diagnosticKeys.has(key)) {
        diagnosticKeys.add(key);
        diagnostics.push(issue);
      }
    }
    if (analysis.valid) {
      const derived = deriveViewModelFromSemanticDocuments({
        semanticDocuments: analysis.semanticDocuments,
        entryAbsolutePath,
      });
      for (const issue of derived.issues) {
        const issuePath = typeof issue.source === 'string' && issue.source !== ''
          ? relativeOutputPath(outputRootAbsolute, issue.source)
          : path.posix.join(OUTPUT_ROOT, sourceSet.entryPath);
        const diagnostic = createDiagnostic(issue.code, issuePath, issue.message, '按 SysML 元数据与语义关系契约修正 source set。');
        const key = `${diagnostic.code}|${diagnostic.path}|${diagnostic.message}`;
        if (!diagnosticKeys.has(key)) {
          diagnosticKeys.add(key);
          diagnostics.push(diagnostic);
        }
      }
      if (derived.viewModel) {
        derivedViewModel = derived.viewModel;
        derivedValidation = validateViewModel(derived.viewModel);
        for (const error of derivedValidation.errors) {
          const diagnostic = createDiagnostic(error.code, error.path, error.message, '修正导致派生视图模型无效的 SysML 语义来源。');
          const key = `${diagnostic.code}|${diagnostic.path}|${diagnostic.message}`;
          if (!diagnosticKeys.has(key)) {
            diagnosticKeys.add(key);
            diagnostics.push(diagnostic);
          }
        }
        for (const finding of derivedValidation.findings) {
          const diagnostic = createDiagnostic(finding.code, finding.path, finding.message, `为需求 ${finding.requirementId} 增加真实的 SysML satisfy/structure/behavior 覆盖证据。`, 'warning');
          const key = `${diagnostic.code}|${diagnostic.path}|${diagnostic.message}`;
          if (!diagnosticKeys.has(key)) {
            diagnosticKeys.add(key);
            diagnostics.push(diagnostic);
          }
        }
        const actualViewKinds = new Set(derivedViewModel.views.map((view) => view.kind));
        for (const requiredKind of REQUIRED_VIEW_KINDS) {
          if (!actualViewKinds.has(requiredKind)) {
            const diagnostic = createDiagnostic('missing-view', '$.views', `缺少必需视图 kind=${requiredKind}。`, '补齐派生所需的 SysML 结构与关系。');
            const key = `${diagnostic.code}|${diagnostic.path}|${diagnostic.message}`;
            if (!diagnosticKeys.has(key)) {
              diagnosticKeys.add(key);
              diagnostics.push(diagnostic);
            }
          }
        }
      }
    }
  } catch (error) {
    diagnostics.push(
      createDiagnostic(
        'sysml-entry-analysis-failed',
        path.posix.join(OUTPUT_ROOT, sourceSet.entryPath),
        error instanceof Error ? error.message : String(error),
        '修复入口文件与多文件 source set 后重试。',
      ),
    );
  }

  const valid = !diagnostics.some((diagnostic) => diagnostic.severity === 'error') && derivedViewModel && derivedValidation;
  return {
    valid: Boolean(valid),
    diagnostics,
    checkedRules,
    draft: valid
      ? {
          sourceSet,
          viewModel: derivedViewModel,
          validation: derivedValidation,
        }
      : undefined,
  };
}

export async function createModelingWorkspace({ confirmedData, sourceText }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mbse-agent-workspace-'));
  const inputDir = path.join(root, 'input');
  const referencesDir = path.join(root, 'references');
  const outputDir = path.join(root, OUTPUT_ROOT);
  const scratchDirectories = ['scripts', 'data', 'logs', 'notes'];
  await Promise.all([
    mkdir(inputDir, { recursive: true }),
    mkdir(referencesDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
    ...scratchDirectories.map((directory) => mkdir(path.join(root, 'scratch', directory), { recursive: true })),
  ]);

  await Promise.all([
    writeFile(path.join(root, 'WORKSPACE.md'), workspaceReadme(confirmedData, root), 'utf8'),
    writeFile(path.join(inputDir, 'confirmed-data.json'), `${JSON.stringify(confirmedData, null, 2)}\n`, 'utf8'),
    writeFile(path.join(inputDir, 'source-material.md'), sourceText, 'utf8'),
    copyReference('./references/WORKBENCH_MODELING_GUIDE.md', path.join(referencesDir, 'WORKBENCH_MODELING_GUIDE.md')),
    copyReference('./references/VIEW_MODEL_CONTRACT.md', path.join(referencesDir, 'VIEW_MODEL_CONTRACT.md')),
    copyReference('../sample-projects/tianwen-2/model/model.sysml', path.join(referencesDir, 'example-source-set', 'model.sysml')),
    copyReference('../sample-projects/tianwen-2/model/requirements.sysml', path.join(referencesDir, 'example-source-set', 'requirements.sysml')),
    copyReference('../sample-projects/tianwen-2/model/structure.sysml', path.join(referencesDir, 'example-source-set', 'structure.sysml')),
    copyReference('../sample-projects/tianwen-2/model/behavior.sysml', path.join(referencesDir, 'example-source-set', 'behavior.sysml')),
    copyReference('../sample-projects/tianwen-2/model/constraints.sysml', path.join(referencesDir, 'example-source-set', 'constraints.sysml')),
    copyReference('../sample-projects/tianwen-2/model/view-model.json', path.join(referencesDir, 'example-derived-view-model.json')),
    copyReference('../docs/adr/0003-sysml-v2-and-json-view-model.md', path.join(referencesDir, 'adr-sysml-view-model.md')),
    copyReference('../docs/adr/0008-expanded-view-set.md', path.join(referencesDir, 'adr-expanded-view-set.md')),
    copyReference('../docs/adr/0009-static-validation-for-ibd-param.md', path.join(referencesDir, 'adr-static-validation.md')),
  ]);

  let completion;

  const verify = async () => verifyWorkspaceOutputs(root);

  const verifyTool = {
    name: 'verify',
    label: 'Verify MBSE workspace',
    description: `可在任何阶段调用的工作区权威反馈工具，调用参数始终是空对象 {}。不要求 SysML 先完整或满足任何前置条件。它会检查固定 source set（${OUTPUT_SOURCE_FILES.map((file) => absoluteWorkspacePath(root, file)).join('、')}），对已有文件执行 strict sysml2，从语义结果派生 JSON 视图模型，并按 output/*.sysml 文件分组返回绝对路径、位置、原因和修改指令（具体指明 write/edit）。返回 VERIFY_RESULT: INVALID_SYSML 表示工具调用及参数均正确，只是候选文件需要修改；请编辑指定 SysML 文件后用同样的 {} 参数再次调用，不要反复调整参数，也不要用 Python/eval 复刻校验。若存在 ${absoluteWorkspacePath(root, OUTPUT_VIEW_MODEL_PATH)} 会直接报告违规文件。`,
    parameters: VERIFY_PARAMETERS,
    approval: 'read',
    execute: async () => {
      const verification = await verify();
      const affectedFiles = verificationAffectedFiles(verification);
      return {
        content: [{ type: 'text', text: formatVerification(verification, 'verify', root) }],
        details: {
          status: verification.valid ? 'passed' : 'validation-failed',
          invocationAccepted: true,
          invocationParameters: {},
          affectedFiles,
          nextAction: verification.valid ? 'continue-to-yield' : 'edit-sysml-candidates-and-retry-verify',
          verification: { ...verification, draft: undefined },
        },
      };
    },
  };

  const yieldTool = {
    name: 'yield',
    label: 'Complete verified MBSE workspace',
    description: '仅在工作完全完成时调用。参数只提交执行记录；工具会重新校验固定多文件 SysML 输出，失败时返回同一诊断并继续工作。',
    parameters: YIELD_PARAMETERS,
    approval: 'read',
    execute: async (_toolCallId, report) => {
      const verification = await verify();
      if (!verification.valid || !verification.draft) {
        throw new Error(formatVerification(verification, 'yield', root));
      }
      completion = {
        report,
        verification: { ...verification, draft: undefined },
        draft: verification.draft,
      };
      return {
        content: [{ type: 'text', text: `yield accepted\n${formatVerification(verification, 'yield', root)}` }],
        details: {
          status: 'success',
          report,
          verification: { ...verification, draft: undefined },
        },
      };
    },
  };

  return {
    root,
    tools: [verifyTool, yieldTool],
    verify,
    getCompletion: () => completion,
    dispose: async () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  };
}

export const modelingWorkspacePaths = {
  outputRoot: OUTPUT_ROOT,
  entry: path.posix.join(OUTPUT_ROOT, MODEL_SOURCE_SET_ENTRY_FILE),
  files: OUTPUT_SOURCE_FILES,
  forbiddenViewModel: OUTPUT_VIEW_MODEL_PATH,
};
