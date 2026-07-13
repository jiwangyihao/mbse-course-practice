import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCandidateWorkspace } from '../sidecar/candidate-workspace.mjs';
import { createCandidateVerificationGate } from '../sidecar/candidate-verification-tool.mjs';
import { createModelingWorkspace } from '../sidecar/modeling-workspace.mjs';
import { validateSysmlWithLsp } from '../sidecar/sysml-validator.mjs';
import { defaultTianwen2ConfirmedData } from '../src/domain/modelGeneration.ts';

const activeWorkspaces = [];
const candidateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectId: { type: 'string' },
  },
  required: ['projectId'],
};


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

describe('候选抽取临时工作区', () => {
  it('预建完整目录骨架并声明唯一候选文件的绝对路径', async () => {
    const workspace = await createCandidateWorkspace('候选材料', candidateSchema);
    activeWorkspaces.push(workspace);

    const directories = await Promise.all([
      'input',
      'references',
      'output',
      'scratch/scripts',
      'scratch/data',
      'scratch/logs',
      'scratch/notes',
    ].map((relativePath) => stat(path.join(workspace.root, relativePath))));
    expect(directories.every((entry) => entry.isDirectory())).toBe(true);
    expect(path.isAbsolute(workspace.candidatePath)).toBe(true);
    expect(workspace.candidatePath).toBe(path.join(workspace.root, 'output', 'confirmed-data.json'));
    await expect(stat(workspace.candidatePath)).rejects.toMatchObject({ code: 'ENOENT' });

    const [readme, schema] = await Promise.all([
      readFile(path.join(workspace.root, 'WORKSPACE.md'), 'utf8'),
      readFile(path.join(workspace.root, 'references', 'confirmed-data.schema.json'), 'utf8'),
    ]);
    expect(readme).toContain(workspace.candidatePath);
    expect(readme).toMatch(/write.*confirmed-data\.json|confirmed-data\.json.*write/s);
    expect(readme).toMatch(/edit.*修改|修改.*edit/s);
    expect(readme).toMatch(/verify_candidate.*空对象 \{\}/s);
    expect(readme).toMatch(/scratch\/scripts\//);
    expect(JSON.parse(schema)).toEqual(candidateSchema);
  });
  it('只有固定文件通过校验且未再修改时才允许 yield', async () => {
    const workspace = await createCandidateWorkspace('候选材料', candidateSchema);
    activeWorkspaces.push(workspace);
    const gate = createCandidateVerificationGate({
      candidatePath: workspace.candidatePath,
      validateConfirmedData: (candidate) => {
        if (!candidate || typeof candidate !== 'object' || !('projectId' in candidate)) {
          throw new Error('confirmedData 缺少 projectId。');
        }
      },
    });
    const handlers = new Map();
    gate.createYieldGuardExtension({
      on: (event, handler) => handlers.set(event, handler),
    });
    const yieldGuard = handlers.get('tool_call');

    const missing = await yieldGuard({ toolName: 'yield' });
    expect(missing).toMatchObject({ block: true });
    expect(missing.reason).toContain(workspace.candidatePath);
    expect(missing.reason).toMatch(/文件不存在.*write|write.*文件不存在/s);

    await writeFile(workspace.candidatePath, '{"projectId":"candidate"}\n', 'utf8');
    await expect(yieldGuard({ toolName: 'yield' })).resolves.toMatchObject({ block: true });
    await expect(gate.tool.execute('verify-candidate', {}))
      .resolves.toMatchObject({ details: { valid: true, status: 'passed' } });
    await expect(yieldGuard({ toolName: 'yield' })).resolves.toBeUndefined();
    await expect(gate.requireVerifiedCandidate()).resolves.toEqual({ projectId: 'candidate' });

    await writeFile(workspace.candidatePath, '{"projectId":"changed"}\n', 'utf8');
    const changed = await yieldGuard({ toolName: 'yield' });
    expect(changed).toMatchObject({ block: true });
    expect(changed.reason).toMatch(/通过校验后又被修改/);
  });

});

describe('建模工作区 verify/yield 契约', () => {
  it('写入输入、规范和固定输出路径说明', async () => {
    const workspace = await createWorkspace();
    const [readme, confirmedData, guide, contract] = await Promise.all([
      readFile(path.join(workspace.root, 'WORKSPACE.md'), 'utf8'),
      readFile(path.join(workspace.root, 'input', 'confirmed-data.json'), 'utf8'),
      readFile(path.join(workspace.root, 'references', 'WORKBENCH_MODELING_GUIDE.md'), 'utf8'),
      readFile(path.join(workspace.root, 'references', 'VIEW_MODEL_CONTRACT.md'), 'utf8'),
    ]);

    const workspaceDirectories = await Promise.all([
      'output',
      'scratch/scripts',
      'scratch/data',
      'scratch/logs',
      'scratch/notes',
    ].map((relativePath) => stat(path.join(workspace.root, relativePath))));
    expect(workspaceDirectories.every((entry) => entry.isDirectory())).toBe(true);
    expect(readme).toContain(path.join(workspace.root, 'output', 'model.sysml'));
    expect(readme).toContain('output/model.sysml');
    expect(readme).toContain(path.join(workspace.root, 'output', 'view-model.json'));
    expect(JSON.parse(confirmedData).projectId).toBe('tianwen-2');
    expect(guide).toContain('output/requirements.sysml');
    expect(contract).toContain('sysml-source-set-derived');
    expect(readme).toMatch(/verify 是.*不是.*门槛/);
    expect(readme).toMatch(/eval 只用于短小.*scratch\/scripts\//s);
    expect(guide).toMatch(/当前最好的一版 SysML.*可以不完整/s);
    expect(guide).toMatch(/scratch\/scripts\/check_model\.py/);
    expect(guide).toMatch(/不要用自写 Python.*替代 `verify`/);
    const verifyTool = workspace.tools.find((tool) => tool.name === 'verify');
    expect(verifyTool?.description).toMatch(/任何阶段.*不要求 SysML.*前置条件.*按 output\/\*\.sysml 文件分组.*路径、位置、原因和修改指令/s);
    expect(verifyTool?.description).toMatch(/不要用 Python\/eval 复刻校验/);
  });
  it('verify 失败明确区分工具参数与 SysML 文件诊断', async () => {
    const workspace = await createWorkspace();
    await writeFile(
      path.join(workspace.root, 'output', 'model.sysml'),
      `package ${defaultTianwen2ConfirmedData.packageName} { part def Broken `,
      'utf8',
    );
    const verifyTool = workspace.tools.find((tool) => tool.name === 'verify');
    const result = await verifyTool.execute('verify-diagnostics', {});
    const text = result.content[0]?.text ?? '';

    expect(text).toMatch(/工具调用成功.*参数.*正确.*不是工具参数错误/s);
    expect(text).toContain(path.join(workspace.root, 'output', 'model.sysml'));
    expect(text).toMatch(/需要修改的 SysML 候选文件/s);
    expect(text).toMatch(/文件（绝对路径）：.*model\.sysml.*位置：第 1 行，第 \d+ 列/s);
    expect(text).toMatch(/(?:编辑|修改).*SysML 候选文件.*再次调用 verify/s);
    expect(text).not.toContain('verify failed');
    expect(result.details).toMatchObject({
      status: 'validation-failed',
      invocationAccepted: true,
      affectedFiles: expect.arrayContaining(['output/model.sysml']),
    });
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
