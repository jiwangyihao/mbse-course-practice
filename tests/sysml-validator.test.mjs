import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSysml2Analysis, validateSysmlWithSysml2 } from '../sidecar/sysml2-backend.mjs';
import { validateSysml, validateSysmlWithLsp } from '../sidecar/sysml-validator.mjs';

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
    '同一路径磁盘语义 A、text 语义 B 时返回 text 语义且不产生重复定义诊断',
    async () => {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-sysml2-overlay-'));
      const reqsPath = path.join(workspaceRoot, 'reqs.sysml');
      const structureOverlayPath = path.join(workspaceRoot, 'structure.sysml');
      await Promise.all([
        writeFile(reqsPath, 'package DemoReqs {\n  requirement def RootReq;\n  requirement def AlternateReq;\n}\n', 'utf8'),
        writeFile(
          structureOverlayPath,
          'package DemoStruct {\n  private import DemoReqs::*;\n\n  part vehicle {\n    satisfy RootReq by vehicle;\n  }\n}\n',
          'utf8',
        ),
      ]);

      try {
        const analysis = await runSysml2Analysis({
          workspaceRoot,
          filePath: structureOverlayPath,
          text: 'package DemoStruct {\n  private import DemoReqs::*;\n\n  part vehicle {\n    satisfy AlternateReq by vehicle;\n  }\n}\n',
          timeoutMs: 120_000,
        });
        expect(analysis.valid).toBe(true);
        expect(
          analysis.diagnostics.map((diagnostic) => diagnostic.message).join('\n'),
          'overlay 只应暴露 text 版本，不能把原工作区同一路径旧文件再次暴露成重复定义',
        ).not.toMatch(/duplicate definition|duplicate/i);

        const structureDoc = analysis.semanticDocuments.find((document) => document.meta?.source?.endsWith('structure.sysml'));
        expect(structureDoc, 'overlay 运行后仍应返回结构文档').toBeDefined();
        if (!structureDoc) return;

        const satisfyRelationship = structureDoc.relationships.find((relationship) => relationship.type === 'Satisfy');
        expect(satisfyRelationship, 'overlay 语义必须来自 text，而不是旧磁盘文件').toEqual(
          expect.objectContaining({
            sourceRaw: 'AlternateReq',
            resolvedSource: 'DemoReqs::AlternateReq',
            resolvedTarget: 'DemoStruct::vehicle',
          }),
        );
      } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );
  it(
    '当 filePath 位于 workspaceRoot 外部时保留原始诊断与 meta.source 路径',
    async () => {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-sysml2-external-root-'));
      const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-sysml2-external-file-'));
      const reqsPath = path.join(workspaceRoot, 'reqs.sysml');
      const externalFilePath = path.join(externalRoot, 'structure.sysml');
      await Promise.all([
        writeFile(reqsPath, 'package DemoReqs {\n  requirement def RootReq;\n  requirement def AlternateReq;\n}\n', 'utf8'),
        writeFile(
          externalFilePath,
          'package DemoStruct {\n  private import DemoReqs::*;\n\n  part vehicle {\n    satisfy RootReq by vehicle;\n  }\n}\n',
          'utf8',
        ),
      ]);

      try {
        const analysis = await runSysml2Analysis({
          workspaceRoot,
          filePath: externalFilePath,
          text: 'package DemoStruct {\n  private import DemoReqs::*;\n\n  part vehicle {\n    satisfy AlternateReq by vehicle;\n  }\n}\n',
          timeoutMs: 120_000,
        });
        expect(analysis.valid).toBe(true);

        const structureDoc = analysis.semanticDocuments.find((document) => document.meta?.source === externalFilePath);
        expect(structureDoc, 'overlay 返回的 meta.source 必须回映射到原始外部 filePath').toBeDefined();
        if (!structureDoc) return;

        const satisfyRelationship = structureDoc.relationships.find((relationship) => relationship.type === 'Satisfy');
        expect(satisfyRelationship, '外部目标导入 workspaceRoot 内包时必须继续解析为 text 语义').toEqual(
          expect.objectContaining({
            sourceRaw: 'AlternateReq',
            resolvedSource: 'DemoReqs::AlternateReq',
            resolvedTarget: 'DemoStruct::vehicle',
          }),
        );

        const brokenText = 'package DemoStruct {\n  private import DemoReqs::*;\n\n  part vehicle {\n    satisfy AlternateReq by vehicle\n  }\n}\n';
        const invalidValidation = await validateSysmlWithSysml2({
          workspaceRoot,
          filePath: externalFilePath,
          text: brokenText,
          timeoutMs: 120_000,
        });
        expect(invalidValidation.valid).toBe(false);
        expect(
          invalidValidation.diagnostics,
          '外部文件 overlay 诊断必须指回原始 filePath，而不是错误映射到 workspaceRoot/<basename>',
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              filePath: externalFilePath,
            }),
          ]),
        );
      } finally {
        await Promise.all([
          rm(workspaceRoot, { recursive: true, force: true }),
          rm(externalRoot, { recursive: true, force: true }),
        ]);
      }
    },
    120_000,
  );

  it(
    '外部同名 basename overlay 不覆盖工作区原有模型',
    async () => {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-sysml2-same-basename-workspace-'));
      const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-sysml2-same-basename-external-'));
      const workspaceFilePath = path.join(workspaceRoot, 'structure.sysml');
      const externalFilePath = path.join(externalRoot, 'structure.sysml');
      await Promise.all([
        writeFile(workspaceFilePath, 'package WorkspacePkg {\n  part def SharedPart;\n}\n', 'utf8'),
        writeFile(
          externalFilePath,
          'package ExternalPkg {\n  private import WorkspacePkg::*;\n  part externalVehicle : SharedPart;\n}\n',
          'utf8',
        ),
      ]);

      try {
        const analysis = await runSysml2Analysis({
          workspaceRoot,
          filePath: externalFilePath,
          text: await readFile(externalFilePath, 'utf8'),
          timeoutMs: 120_000,
        });
        expect(
          analysis.valid,
          '外部目标与工作区文件同名时，overlay 仍必须保留工作区模型参与导入解析',
        ).toBe(true);

        const sources = analysis.semanticDocuments
          .map((document) => document.meta?.source)
          .filter((source) => typeof source === 'string');
        expect(sources).toEqual(expect.arrayContaining([workspaceFilePath, externalFilePath]));

        const packageIds = analysis.semanticDocuments
          .flatMap((document) => document.elements ?? [])
          .filter((element) => element.type === 'Package')
          .map((element) => element.id);
        expect(packageIds).toEqual(expect.arrayContaining(['WorkspacePkg', 'ExternalPkg']));
      } finally {
        await Promise.all([
          rm(workspaceRoot, { recursive: true, force: true }),
          rm(externalRoot, { recursive: true, force: true }),
        ]);
      }
    },
    120_000,
  );


  it(
    '统一 seam 在 sysml2 失败且 LSP 放行时仍返回 sysml2 结果',
    async () => {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mbse-sysml2-seam-'));
      const filePath = path.join(workspaceRoot, 'minimal.sysml');
      const text = 'package Demo {\n  interface def SampleTransfer {}\n  part def Vehicle {\n    port outlet : SampleTransfer;\n  }\n  part demoVehicle : Vehicle;\n}\n';
      await writeFile(filePath, text, 'utf8');

      try {
        const [lspValidation, seamValidation] = await Promise.all([
          validateSysmlWithLsp({ workspaceRoot, filePath, text, timeoutMs: 30_000 }),
          validateSysml({ workspaceRoot, filePath, text, timeoutMs: 120_000 }),
        ]);

        expect(lspValidation.valid, '该专用夹具必须证明 LSP 会放行，否则无法锁住 fallback 回归').toBe(true);
        expect(seamValidation.backend).toBe('sysml2');
        expect(seamValidation.valid, 'sysml2 已给出无效结果时，统一 seam 不得再被 LSP 覆盖成有效').toBe(false);
        expect(seamValidation.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: 'sysml2',
              line: 4,
              column: 10,
              filePath,
            }),
          ]),
        );
        expect(
          seamValidation.diagnostics.map((diagnostic) => diagnostic.message).join('\n'),
          'sysml2 无效结果必须保留其真实语义，不得被统一 seam 吞掉',
        ).toMatch(/cannot be typed|E3006/i);
      } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
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
