import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createModelingWorkspace } from '../sidecar/modeling-workspace.mjs';
import { validateSysmlWithLsp } from '../sidecar/sysml-validator.mjs';
import { defaultTianwen2ConfirmedData } from '../src/domain/modelGeneration.ts';

const activeWorkspaces = [];

afterEach(async () => {
  await Promise.all(activeWorkspaces.splice(0).map((workspace) => workspace.dispose()));
});

async function createWorkspace() {
  const sourceText = await readFile('sample-projects/tianwen-2/materials/source-material.md', 'utf8');
  const workspace = await createModelingWorkspace({
    confirmedData: defaultTianwen2ConfirmedData,
    sourceText,
  });
  activeWorkspaces.push(workspace);
  return workspace;
}

async function writeValidArtifacts(workspace) {
  const outputDir = path.join(workspace.root, 'output');
  await mkdir(outputDir, { recursive: true });
  const sourceFiles = [
    'model.sysml',
    'requirements.sysml',
    'structure.sysml',
    'behavior.sysml',
    'constraints.sysml',
  ];
  await Promise.all(sourceFiles.map(async (file) => {
    const content = await readFile(path.join('sample-projects', 'tianwen-2', 'model', file), 'utf8');
    await writeFile(path.join(outputDir, file), content, 'utf8');
  }));
  const sourceSet = (await Promise.all(sourceFiles.map(async (file) => ({
    path: file,
    content: await readFile(path.join('sample-projects', 'tianwen-2', 'model', file), 'utf8'),
  })))).sort((left, right) => left.path.localeCompare(right.path));
  const derivedViewModel = JSON.parse(await readFile(path.join('sample-projects', 'tianwen-2', 'model', 'view-model.json'), 'utf8'));
  return { sourceSet, viewModel: derivedViewModel };
}

describe('建模工作区 verify/yield 契约', () => {
  it('写入输入、规范和固定输出路径说明', async () => {
    const workspace = await createWorkspace();
    const [readme, confirmedData, guide, contract] = await Promise.all([
      readFile(path.join(workspace.root, 'WORKSPACE.md'), 'utf8'),
      readFile(path.join(workspace.root, 'input', 'confirmed-data.json'), 'utf8'),
      readFile(path.join(workspace.root, 'references', 'WORKBENCH_MODELING_GUIDE.md'), 'utf8'),
      readFile(path.join(workspace.root, 'references', 'VIEW_MODEL_CONTRACT.md'), 'utf8'),
    ]);

    expect(readme).toContain('output/model.sysml');
    expect(readme).toContain('禁止创建 output/view-model.json');
    expect(JSON.parse(confirmedData).projectId).toBe('tianwen-2');
    expect(guide).toContain('output/requirements.sysml');
    expect(contract).toContain('sysml-source-set-derived');
  });
  it('verify 在最小 LSP 放行但 sysml2 拒绝的 SysML 上阻止工作区通过', async () => {
    const workspace = await createWorkspace();
    await writeValidArtifacts(workspace);
    const strictRejectingSysml = [
      `package ${defaultTianwen2ConfirmedData.packageName} {`,
      `  doc /* ${[
        ...defaultTianwen2ConfirmedData.requirements.map((requirement) => requirement.id),
        ...defaultTianwen2ConfirmedData.subsystems.flatMap((subsystem) => [subsystem.id, subsystem.name]),
      ].join(' | ')} */`,
      '  interface def SampleTransfer {}',
      '  part def Vehicle {',
      '    port outlet : SampleTransfer;',
      '  }',
      '  part demoVehicle : Vehicle;',
      '}',
      '',
    ].join('\n');
    await writeFile(path.join(workspace.root, 'output', 'model.sysml'), strictRejectingSysml, 'utf8');
    

    const modelPath = path.join(workspace.root, 'output', 'model.sysml');
    const outputWorkspaceRoot = path.join(workspace.root, 'output');
    const [lspValidation, verification] = await Promise.all([
      validateSysmlWithLsp({
        workspaceRoot: outputWorkspaceRoot,
        filePath: modelPath,
        text: strictRejectingSysml,
        timeoutMs: 30_000,
      }),
      workspace.verify(),
    ]);

    expect(
      lspValidation.valid,
      '该最小夹具必须先证明 LSP 不会报阻断诊断，否则无法覆盖旧 fallback 的差异条件',
    ).toBe(true);
    expect(verification.valid).toBe(false);
    expect(verification.checkedRules).toContain('strict-sysml2-per-file');
    expect(verification.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          code: 'sysml-syntax',
          path: expect.stringMatching(/output\/model\.sysml:\d+:\d+/),
          message: expect.stringMatching(/cannot be typed/i),
        }),
      ]),
    );
    expect(
      verification.diagnostics.some((diagnostic) => diagnostic.code === 'sysml2-fallback'),
      'strict verify 不得再把 sysml2 失败降级为 warning',
    ).toBe(false);
  }, 120_000);

  it('verify 接受内置样例工件并保持 strict sysml2 通过', async () => {
    const workspace = await createWorkspace();
    await writeValidArtifacts(workspace);

    const verification = await workspace.verify();

    expect(verification.valid).toBe(true);
    expect(verification.checkedRules).toContain('strict-sysml2-per-file');
    expect(verification.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(
      verification.diagnostics.some((diagnostic) => ['sysml2-fallback', 'sysml-backend-unavailable'].includes(diagnostic.code)),
      '内置样例验收必须走 strict sysml2，而不是 fallback 或后端缺失路径',
    ).toBe(false);
  }, 120_000);

  it('verify 返回可定位的 SysML parser 错误', async () => {
    const workspace = await createWorkspace();
    await writeValidArtifacts(workspace);
    await writeFile(
      path.join(workspace.root, 'output', 'model.sysml'),
      `package ${defaultTianwen2ConfirmedData.packageName} {\n  requirement def {\n}\n`,
      'utf8',
    );

    const verification = await workspace.verify();

    expect(verification.valid).toBe(false);
    expect(verification.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'sysml-syntax', path: expect.stringMatching(/model\.sysml:\d+:\d+/) }),
      ]),
    );
  }, 120_000);

  it('yield 原子复用 verify，只接收报告并保存本次已验证文件内容', async () => {
    const workspace = await createWorkspace();
    const expected = await writeValidArtifacts(workspace);
    const yieldTool = workspace.tools.find((tool) => tool.name === 'yield');
    expect(
      yieldTool.parameters.safeParse({
        summary: '报告',
        actions: ['步骤'],
        verificationNotes: [],
        sysmlText: '禁止通过 yield 提交工件',
      }).success,
      'yield 参数必须严格拒绝执行报告之外的工件字段',
    ).toBe(false);


    const result = await yieldTool.execute('yield-call', {
      summary: '完成六视图 SysML v2 建模并通过校验。',
      actions: ['读取 confirmed-data.json', '创建固定输出文件', '调用 verify 并修正诊断'],
      verificationNotes: ['最终 verify passed'],
    });

    expect(result.details.status).toBe('success');
    expect(workspace.getCompletion().report.summary).toContain('完成六视图');
    expect(workspace.getCompletion().draft.sourceSet.files).toEqual(expected.sourceSet);
    expect(workspace.getCompletion().draft.viewModel).toEqual(expected.viewModel);
  }, 120_000);

  it('yield 在 verify 失败时返回同一份诊断且不完成会话', async () => {
    const workspace = await createWorkspace();
    const yieldTool = workspace.tools.find((tool) => tool.name === 'yield');

    await expect(
      yieldTool.execute('yield-call', {
        summary: '错误地提前完成。',
        actions: ['尚未创建输出'],
        verificationNotes: [],
      }),
    ).rejects.toThrow(/\[error:missing-source-file\].*output\/model\.sysml/s);
    expect(workspace.getCompletion()).toBeUndefined();
  }, 120_000);
});
