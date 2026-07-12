import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { validateViewModel } from '../src/domain/modelGeneration.ts';
import { validateSysmlWithLspFallback } from './sysml-validator.mjs';

const REQUIRED_VIEW_KINDS = [
  'requirements',
  'bdd',
  'activity',
  'traceability-matrix',
  'ibd',
  'parameter-constraints',
];
const OUTPUT_SYSML_PATH = 'output/model.sysml';
const OUTPUT_VIEW_MODEL_PATH = 'output/view-model.json';
const PLACEHOLDER_PATTERN = /(?:<[A-Za-z][A-Za-z0-9._-]*>|\bTODO\b|\bplaceholder\b)/i;

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectStringValues(value, target = new Set()) {
  if (typeof value === 'string') {
    target.add(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectStringValues(entry, target);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectStringValues(entry, target);
  }
  return target;
}

function createDiagnostic(code, pathValue, message, hint, severity = 'error') {
  return { severity, code, path: pathValue, message, hint };
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

function formatVerification(verification) {
  const warningCount = verification.diagnostics.filter((item) => item.severity === 'warning').length;
  if (verification.valid) {
    const lines = [
      'verify passed',
      `- SysML: ${OUTPUT_SYSML_PATH}`,
      `- view model: ${OUTPUT_VIEW_MODEL_PATH}`,
      `- checked rules: ${verification.checkedRules.length}`,
      `- warnings: ${warningCount}`,
    ];
    for (const warning of verification.diagnostics.filter((item) => item.severity === 'warning')) {
      lines.push(`- [warning:${warning.code}] ${warning.path}: ${warning.message}`);
    }
    return lines.join('\n');
  }
  const lines = [`verify failed: ${verification.diagnostics.length} diagnostic(s)`];
  for (const diagnostic of verification.diagnostics) {
    lines.push(`- [${diagnostic.severity}:${diagnostic.code}] ${diagnostic.path}: ${diagnostic.message}`);
    if (diagnostic.hint) lines.push(`  hint: ${diagnostic.hint}`);
  }
  return lines.join('\n');
}

async function verifyArtifactContents(confirmedData, sysmlText, rawViewModel, workspaceRoot) {
  const diagnostics = [];
  let viewModel;

  if (sysmlText.trim() === '') {
    diagnostics.push(createDiagnostic('empty-sysml', OUTPUT_SYSML_PATH, 'SysML 文件为空。', '生成完整 package。'));
  }
  if (PLACEHOLDER_PATTERN.test(sysmlText)) {
    diagnostics.push(createDiagnostic('placeholder', OUTPUT_SYSML_PATH, 'SysML 中仍存在占位符或 TODO。', '替换为已确认事实。'));
  }

  const sysmlWorkspaceRoot = path.join(workspaceRoot, 'output');
  const sysmlValidation = await validateSysmlWithLspFallback({
    workspaceRoot: sysmlWorkspaceRoot,
    filePath: path.join(sysmlWorkspaceRoot, 'model.sysml'),
    text: sysmlText,
  });
  if (sysmlValidation.fallback?.from === 'sysml2') {
    const sysml2Message = sysmlValidation.fallback.originalValidation?.diagnostics?.[0]?.message ?? 'sysml2 返回了未通过诊断。';
    diagnostics.push(
      createDiagnostic(
        'sysml2-fallback',
        OUTPUT_SYSML_PATH,
        `sysml2 未通过，当前临时回退到 LSP：${sysml2Message}`,
        '修复 sysml2 诊断后再视为完全兼容。',
        'warning',
      ),
    );
  }
  for (const diagnostic of sysmlValidation.diagnostics.filter((item) => item.severity <= 2)) {
    const isBenignUnusedDefinition =
      diagnostic.severity === 2 &&
      diagnostic.source === 'sysml' &&
      /^Definition '.+' is not referenced by any usage in the workspace$/.test(diagnostic.message);
    diagnostics.push(
      createDiagnostic(
        'sysml-syntax',
        `${OUTPUT_SYSML_PATH}:${diagnostic.line}:${diagnostic.column}`,
        diagnostic.message,
        '按本地 SysML v2 parser/compiler 诊断修正语法或语义错误。',
        isBenignUnusedDefinition ? 'warning' : 'error',
      ),
    );
  }

  try {
    viewModel = JSON.parse(rawViewModel);
  } catch (error) {
    diagnostics.push(
      createDiagnostic(
        'invalid-json',
        OUTPUT_VIEW_MODEL_PATH,
        `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
        '修正 JSON 语法后重试。',
      ),
    );
  }

  if (viewModel) {
    if (PLACEHOLDER_PATTERN.test(JSON.stringify(viewModel))) {
      diagnostics.push(
        createDiagnostic('placeholder', OUTPUT_VIEW_MODEL_PATH, 'JSON 视图模型中仍存在占位符或 TODO。', '替换为真实模型元素。'),
      );
    }

    const validation = validateViewModel(viewModel);
    for (const error of validation.errors) {
      diagnostics.push(createDiagnostic(error.code, error.path, error.message, '按路径修正对应视图记录。'));
    }
    for (const finding of validation.findings) {
      diagnostics.push(
        createDiagnostic(
          finding.code,
          finding.path,
          finding.message,
          `为需求 ${finding.requirementId} 增加真实覆盖证据。`,
        ),
      );
    }

    if (viewModel.projectId !== confirmedData.projectId) {
      diagnostics.push(
        createDiagnostic(
          'project-id-mismatch',
          '$.projectId',
          `projectId 必须是 ${confirmedData.projectId}，当前为 ${String(viewModel.projectId)}。`,
          '使用 confirmed-data.json.projectId。',
        ),
      );
    }
    if (viewModel.generatedFrom !== confirmedData.packageName) {
      diagnostics.push(
        createDiagnostic(
          'generated-from-mismatch',
          '$.generatedFrom',
          `generatedFrom 必须是 ${confirmedData.packageName}，当前为 ${String(viewModel.generatedFrom)}。`,
          '使用 confirmed-data.json.packageName。',
        ),
      );
    }
    if (viewModel.source !== 'sdk-agent-generated') {
      diagnostics.push(
        createDiagnostic(
          'source-mismatch',
          '$.source',
          `source 必须是 sdk-agent-generated，当前为 ${String(viewModel.source)}。`,
          '修正根字段 source。',
        ),
      );
    }

    const actualViewKinds = new Set(
      Array.isArray(viewModel.views)
        ? viewModel.views.flatMap((view) => (view && typeof view.kind === 'string' ? [view.kind] : []))
        : [],
    );
    for (const requiredKind of REQUIRED_VIEW_KINDS) {
      if (!actualViewKinds.has(requiredKind)) {
        diagnostics.push(
          createDiagnostic(
            'missing-view',
            '$.views',
            `缺少必需视图 kind=${requiredKind}。`,
            '按 VIEW_MODEL_CONTRACT.md 创建完整视图对象。',
          ),
        );
      }
    }

    const modelStrings = collectStringValues(viewModel);
    for (const requirement of confirmedData.requirements) {
      if (!modelStrings.has(requirement.id)) {
        diagnostics.push(
          createDiagnostic('missing-requirement', '$.views', `视图模型未包含需求 ${requirement.id}。`, '使用稳定需求 ID。'),
        );
      }
    }
    for (const subsystem of confirmedData.subsystems) {
      if (!modelStrings.has(subsystem.id)) {
        diagnostics.push(
          createDiagnostic('missing-subsystem', '$.views', `视图模型未包含分系统 ${subsystem.id}。`, '在 BDD 或 IBD 中使用稳定分系统 ID。'),
        );
      }
    }
  }

  const packagePattern = new RegExp(`\\bpackage\\s+${escapeRegExp(confirmedData.packageName)}\\s*\\{`);
  if (!packagePattern.test(sysmlText)) {
    diagnostics.push(
      createDiagnostic('package-mismatch', OUTPUT_SYSML_PATH, `SysML 顶层 package 必须是 ${confirmedData.packageName}。`, '保持 package 与 generatedFrom 一致。'),
    );
  }
  for (const requirement of confirmedData.requirements) {
    if (!sysmlText.includes(requirement.id)) {
      diagnostics.push(
        createDiagnostic('missing-requirement', OUTPUT_SYSML_PATH, `SysML 未包含需求 ${requirement.id}。`, '创建需求声明或用法。'),
      );
    }
  }
  for (const subsystem of confirmedData.subsystems) {
    if (!sysmlText.includes(subsystem.name) && !sysmlText.includes(subsystem.id)) {
      diagnostics.push(
        createDiagnostic(
          'missing-subsystem',
          OUTPUT_SYSML_PATH,
          `SysML 未包含分系统 ${subsystem.name} (${subsystem.id})。`,
          '创建 part definition 或 part usage。',
        ),
      );
    }
  }

  const checkedRules = [
    'fixed-output-paths',
    'regular-file-no-symlink',
    'sysml-v2-parser',
    'json-schema-and-references',
    'six-required-views',
    'confirmed-requirement-coverage',
    'confirmed-subsystem-coverage',
    'project-package-source-consistency',
    'no-placeholders',
  ];
  const valid = !diagnostics.some((diagnostic) => diagnostic.severity === 'error') && viewModel !== undefined;
  return {
    valid,
    diagnostics,
    checkedRules,
    draft: valid ? { sysmlText, viewModel, validation: validateViewModel(viewModel) } : undefined,
  };
}

async function copyReference(relativeSource, destination) {
  const source = fileURLToPath(new URL(relativeSource, import.meta.url));
  await copyFile(source, destination);
}

function workspaceReadme(confirmedData) {
  return `# Agent 建模工作区\n\n本目录是约定式工作目录，不是操作系统安全沙箱。\n\n## 输入\n- input/confirmed-data.json（唯一事实来源）\n- input/source-material.md（只供追溯语境）\n\n## 参考\n- references/WORKBENCH_MODELING_GUIDE.md\n- references/VIEW_MODEL_CONTRACT.md\n- references/example-model.sysml\n- references/example-view-model.json\n- references/adr-sysml-view-model.md\n- references/adr-expanded-view-set.md\n- references/adr-static-validation.md\n\n## 固定输出\n- ${OUTPUT_SYSML_PATH}\n- ${OUTPUT_VIEW_MODEL_PATH}\n\n当前 projectId：${confirmedData.projectId}\n当前 packageName：${confirmedData.packageName}\n\n反复调用 verify 修正问题。只有 verify 通过后才能调用 yield；yield 参数只允许执行记录报告。\n`;
}

export async function createModelingWorkspace({ confirmedData, sourceText }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mbse-agent-workspace-'));
  const inputDir = path.join(root, 'input');
  const referencesDir = path.join(root, 'references');
  const outputDir = path.join(root, 'output');
  const scratchDir = path.join(root, 'scratch');
  await Promise.all([
    mkdir(inputDir, { recursive: true }),
    mkdir(referencesDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
    mkdir(scratchDir, { recursive: true }),
  ]);

  await Promise.all([
    writeFile(path.join(root, 'WORKSPACE.md'), workspaceReadme(confirmedData), 'utf8'),
    writeFile(path.join(inputDir, 'confirmed-data.json'), `${JSON.stringify(confirmedData, null, 2)}\n`, 'utf8'),
    writeFile(path.join(inputDir, 'source-material.md'), sourceText, 'utf8'),
    copyReference('./references/WORKBENCH_MODELING_GUIDE.md', path.join(referencesDir, 'WORKBENCH_MODELING_GUIDE.md')),
    copyReference('./references/VIEW_MODEL_CONTRACT.md', path.join(referencesDir, 'VIEW_MODEL_CONTRACT.md')),
    copyReference('../sample-projects/tianwen-2/model/tianwen-2.sysml', path.join(referencesDir, 'example-model.sysml')),
    copyReference('../sample-projects/tianwen-2/model/view-model.json', path.join(referencesDir, 'example-view-model.json')),
    copyReference('../docs/adr/0003-sysml-v2-and-json-view-model.md', path.join(referencesDir, 'adr-sysml-view-model.md')),
    copyReference('../docs/adr/0008-expanded-view-set.md', path.join(referencesDir, 'adr-expanded-view-set.md')),
    copyReference('../docs/adr/0009-static-validation-for-ibd-param.md', path.join(referencesDir, 'adr-static-validation.md')),
  ]);

  let completion;

  const verify = async () => {
    const diagnostics = [];
    let sysmlText = '';
    let rawViewModel = '';
    try {
      sysmlText = await readWorkspaceFile(root, OUTPUT_SYSML_PATH);
    } catch (error) {
      diagnostics.push(
        createDiagnostic(
          'missing-or-unsafe-file',
          OUTPUT_SYSML_PATH,
          error instanceof Error ? error.message : String(error),
          `创建普通文件 ${OUTPUT_SYSML_PATH}。`,
        ),
      );
    }
    try {
      rawViewModel = await readWorkspaceFile(root, OUTPUT_VIEW_MODEL_PATH);
    } catch (error) {
      diagnostics.push(
        createDiagnostic(
          'missing-or-unsafe-file',
          OUTPUT_VIEW_MODEL_PATH,
          error instanceof Error ? error.message : String(error),
          `创建普通文件 ${OUTPUT_VIEW_MODEL_PATH}。`,
        ),
      );
    }
    if (diagnostics.length > 0) {
      return { valid: false, diagnostics, checkedRules: ['fixed-output-paths', 'regular-file-no-symlink'] };
    }
    return verifyArtifactContents(confirmedData, sysmlText, rawViewModel, root);
  };

  const verifyTool = {
    name: 'verify',
    label: 'Verify MBSE workspace',
    description: '校验固定路径 output/model.sysml 与 output/view-model.json，返回详尽路径化诊断，不修改工件。',
    parameters: VERIFY_PARAMETERS,
    approval: 'read',
    execute: async () => {
      const verification = await verify();
      return {
        content: [{ type: 'text', text: formatVerification(verification) }],
        details: { verification: { ...verification, draft: undefined } },
      };
    },
  };

  const yieldTool = {
    name: 'yield',
    label: 'Complete verified MBSE workspace',
    description: '仅在工作完全完成时调用。参数只提交执行记录；工具会重新校验固定输出文件，失败时返回同一诊断并继续工作。',
    parameters: YIELD_PARAMETERS,
    approval: 'read',
    execute: async (_toolCallId, report) => {
      const verification = await verify();
      if (!verification.valid || !verification.draft) {
        throw new Error(formatVerification(verification));
      }
      completion = {
        report,
        verification: { ...verification, draft: undefined },
        draft: verification.draft,
      };
      return {
        content: [{ type: 'text', text: `yield accepted\n${formatVerification(verification)}` }],
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
  sysml: OUTPUT_SYSML_PATH,
  viewModel: OUTPUT_VIEW_MODEL_PATH,
};
