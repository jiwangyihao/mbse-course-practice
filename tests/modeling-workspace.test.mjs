import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createModelingWorkspace } from '../sidecar/modeling-workspace.mjs';
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
  const sysmlText = await readFile('sample-projects/tianwen-2/model/tianwen-2.sysml', 'utf8');
  const viewModel = JSON.parse(await readFile('sample-projects/tianwen-2/model/view-model.json', 'utf8'));
  viewModel.source = 'sdk-agent-generated';
  const outputDir = path.join(workspace.root, 'output');
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDir, 'model.sysml'), sysmlText, 'utf8'),
    writeFile(path.join(outputDir, 'view-model.json'), `${JSON.stringify(viewModel, null, 2)}\n`, 'utf8'),
  ]);
  return { sysmlText, viewModel };
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
    expect(readme).toContain('output/view-model.json');
    expect(JSON.parse(confirmedData).projectId).toBe('tianwen-2');
    expect(guide).toContain('verify');
    expect(contract).toContain('traceability-matrix');
  });

  it('verify 使用真实 SysML parser 和视图校验器接受完整工件', async () => {
    const workspace = await createWorkspace();
    await writeValidArtifacts(workspace);

    const verification = await workspace.verify();

    expect(verification.valid).toBe(true);
    expect(verification.checkedRules).toContain('sysml-v2-parser');
    expect(verification.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(
      verification.diagnostics,
      '当工作区依赖 LSP 放行时，verify 必须保留 sysml2 失败的 warning，避免 UI 把它误显示成普通通过',
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          code: 'sysml2-fallback',
          message: expect.stringMatching(/sysml2.*LSP/i),
        }),
      ]),
    );
  }, 120_000);

  it('verify 返回可定位的 SysML parser 错误', async () => {
    const workspace = await createWorkspace();
    const { viewModel } = await writeValidArtifacts(workspace);
    await writeFile(
      path.join(workspace.root, 'output', 'model.sysml'),
      `package ${defaultTianwen2ConfirmedData.packageName} {\n  requirement def {\n}\n`,
      'utf8',
    );
    await writeFile(
      path.join(workspace.root, 'output', 'view-model.json'),
      `${JSON.stringify(viewModel, null, 2)}\n`,
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
    expect(workspace.getCompletion().draft.sysmlText).toBe(expected.sysmlText);
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
    ).rejects.toThrow(/\[error:missing-or-unsafe-file\].*output\/model\.sysml/s);
    expect(workspace.getCompletion()).toBeUndefined();
  }, 120_000);
});
