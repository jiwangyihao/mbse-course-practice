import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSysml2Analysis, validateSysmlWithSysml2 } from '../sidecar/sysml2-backend.mjs';
import { validateSysml } from '../sidecar/sysml-validator.mjs';

const fixtureRoot = path.resolve('tests/fixtures/sysml2-semantic');
const structurePath = path.join(fixtureRoot, '30-structure.sysml');
const constraintsPath = path.join(fixtureRoot, '20-constraints.sysml');
const behaviorPath = path.join(fixtureRoot, '40-behavior.sysml');

describe('vendored sysml2 backend', () => {
  it(
    '通过主仓库 seam 暴露 bind satisfy constraint succession 语义',
    async () => {
      const structureText = await readFile(structurePath, 'utf8');
      const validation = await validateSysml({
        workspaceRoot: fixtureRoot,
        filePath: structurePath,
        text: structureText,
        timeoutMs: 120_000,
      });
      expect(validation.backend, '主仓库 sysml 校验 seam 必须优先命中 vendored sysml2，而不是继续只走 LSP').toBe('sysml2');
      expect(validation.valid).toBe(true);

      const [structureAnalysis, constraintsAnalysis, behaviorAnalysis] = await Promise.all([
        runSysml2Analysis({ workspaceRoot: fixtureRoot, filePath: structurePath, timeoutMs: 120_000 }),
        runSysml2Analysis({ workspaceRoot: fixtureRoot, filePath: constraintsPath, timeoutMs: 120_000 }),
        runSysml2Analysis({ workspaceRoot: fixtureRoot, filePath: behaviorPath, timeoutMs: 120_000 }),
      ]);

      expect(structureAnalysis.valid).toBe(true);
      expect(constraintsAnalysis.valid).toBe(true);
      expect(behaviorAnalysis.valid).toBe(true);

      const structureDoc = structureAnalysis.semanticDocuments.find((document) => document.meta?.source?.endsWith('30-structure.sysml'));
      const constraintsDoc = constraintsAnalysis.semanticDocuments.find((document) => document.meta?.source?.endsWith('20-constraints.sysml'));
      const behaviorDoc = behaviorAnalysis.semanticDocuments.find((document) => document.meta?.source?.endsWith('40-behavior.sysml'));
      expect(structureDoc, '结构夹具必须返回可机读 JSON 文档').toBeDefined();
      expect(constraintsDoc, '约束夹具必须返回可机读 JSON 文档').toBeDefined();
      expect(behaviorDoc, '行为夹具必须返回可机读 JSON 文档').toBeDefined();
      if (!structureDoc || !constraintsDoc || !behaviorDoc) return;

      const bindRelationship = structureDoc.relationships.find((relationship) => relationship.type === 'Bind');
      const satisfyRelationship = structureDoc.relationships.find((relationship) => relationship.type === 'Satisfy');
      const massConstraint = constraintsDoc.elements.find((element) => element.id === 'DemoAnalysis::MassConstraint');
      const successionRelationship = behaviorDoc.relationships.find((relationship) => relationship.type === 'Succession');

      expect(bindRelationship, 'sysml2 语义后端必须输出 bind 关系，而不是只保留原始文本语句').toEqual(
        expect.objectContaining({
          ownerScope: 'DemoStruct::vehicle',
          sourceRaw: 'massConstraint.totalMass',
          targetRaw: 'mass',
        }),
      );
      expect(satisfyRelationship, 'sysml2 语义后端必须输出 satisfy 关系并解析唯一导入目标').toEqual(
        expect.objectContaining({
          ownerScope: 'DemoStruct::vehicle',
          sourceRaw: 'RootReq',
          targetRaw: 'vehicle',
          resolvedSource: 'DemoReqs::RootReq',
          resolvedTarget: 'DemoStruct::vehicle',
        }),
      );
      expect(massConstraint, 'sysml2 语义后端必须暴露 constraint 结果表达式').toEqual(
        expect.objectContaining({
          type: 'ConstraintDef',
          resultExpression: 'totalMass == sum(componentMasses)',
        }),
      );
      expect(successionRelationship, 'sysml2 语义后端必须输出 succession 关系').toEqual(
        expect.objectContaining({
          ownerScope: 'DemoBehavior::Mission',
          sourceRaw: 'approach',
          targetRaw: 'sample',
          resolvedSource: 'DemoBehavior::Mission::approach',
          resolvedTarget: 'DemoBehavior::Mission::sample',
        }),
      );
    },
    120_000,
  );

  it(
    '返回可定位的 sysml2 语法诊断',
    async () => {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-sysml2-invalid-'));
      const filePath = path.join(workspaceRoot, 'broken.sysml');
      await writeFile(filePath, 'package Broken {\n  requirement def {\n}\n', 'utf8');

      try {
        const validation = await validateSysmlWithSysml2({
          workspaceRoot,
          filePath,
          timeoutMs: 120_000,
        });
        expect(validation.backend).toBe('sysml2');
        expect(validation.valid, '语法错误必须被 vendored sysml2 直接拦下').toBe(false);
        expect(validation.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: 'sysml2',
              line: 4,
              column: 1,
            }),
          ]),
        );
        expect(
          validation.diagnostics.map((diagnostic) => diagnostic.message).join('\n'),
          'sysml2 诊断必须保留 syntax error 语义，便于 verify 输出给 Agent 修正',
        ).toMatch(/syntax error/i);
      } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
