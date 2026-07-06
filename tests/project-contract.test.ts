import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, normalize, resolve } from 'node:path';
import process from 'node:process';
import React from 'react';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

type StringEntry = {
  keyPath: string;
  value: string;
};

type ProjectFileEntry = StringEntry & {
  absolutePath: string;
  content: string;
};

const repoRoot = normalize(process.cwd());
const packageJsonPath = resolve(repoRoot, 'package.json');
const packageLockPath = resolve(repoRoot, 'package-lock.json');
const mainEntryPath = resolve(repoRoot, 'src/main.tsx');
const sampleProjectDir = normalize(resolve(repoRoot, 'sample-projects/tianwen-2'));
const metadataPath = resolve(sampleProjectDir, 'project.json');
const forbiddenSmallLabPath = normalize('C:/tmp/mbse-course-lab').toLowerCase();

function readRequiredTextFile(absolutePath: string, label: string) {
  expect(existsSync(absolutePath), `${label} 应存在：${absolutePath}`).toBe(true);

  const content = readFileSync(absolutePath, 'utf8');
  expect(content.trim(), `${label} 不应为空：${absolutePath}`).not.toBe('');

  return content;
}

function readRequiredJsonObject(absolutePath: string, label: string) {
  const content = readRequiredTextFile(absolutePath, label);
  const parsed: unknown = JSON.parse(content);

  expect(
    parsed !== null && !Array.isArray(parsed) && typeof parsed === 'object',
    `${label} 应是 JSON 对象：${absolutePath}`,
  ).toBe(true);

  return parsed as JsonObject;
}

function collectStringEntries(value: JsonValue, keyPath = '$'): StringEntry[] {
  if (typeof value === 'string') {
    return [{ keyPath, value }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectStringEntries(item, `${keyPath}[${index}]`),
    );
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      collectStringEntries(item, `${keyPath}.${key}`),
    );
  }

  return [];
}

function resolveProjectFile(rawPath: string) {
  if (isAbsolute(rawPath)) {
    return normalize(rawPath);
  }

  const sampleRelativePath = normalize(resolve(sampleProjectDir, rawPath));
  if (existsSync(sampleRelativePath)) {
    return sampleRelativePath;
  }

  return normalize(resolve(repoRoot, rawPath));
}

function looksLikeRepositoryFilePath(value: string) {
  if (/^[a-z]+:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) {
    return false;
  }

  return /[\\/]/.test(value) && extname(value) !== '';
}

function collectDeclaredProjectFiles(metadata: JsonObject): ProjectFileEntry[] {
  return collectStringEntries(metadata)
    .filter(({ value }) => looksLikeRepositoryFilePath(value))
    .map((entry) => {
      const absolutePath = resolveProjectFile(entry.value);
      const normalizedPath = normalize(absolutePath).toLowerCase();

      expect(
        normalizedPath.startsWith(normalize(sampleProjectDir).toLowerCase()),
        `样例项目声明的文件必须位于内置天问二号样例目录内，而不是外部工作区：${entry.value}`,
      ).toBe(true);
      expect(
        normalizedPath.includes(forbiddenSmallLabPath),
        `样例项目不得依赖小实验工作区：${entry.value}`,
      ).toBe(false);

      return {
        ...entry,
        absolutePath,
        content: readRequiredTextFile(
          absolutePath,
          `样例项目声明文件 ${entry.keyPath}`,
        ),
      };
    });
}

function expectVisibleText(pattern: RegExp, label: string) {
  expect(screen.queryAllByText(pattern).length, `${label} 应在工作台入口中可见`).toBeGreaterThan(
    0,
  );
}

describe('天问二号样例项目端到端契约', () => {
  it('前端入口使用 Ant Design 组件库和全局样式基线', () => {
    const packageJson = readRequiredJsonObject(packageJsonPath, 'package.json');
    const packageLock = readRequiredJsonObject(packageLockPath, 'package-lock.json');
    const mainEntry = readRequiredTextFile(mainEntryPath, 'React 入口');

    const dependencies = packageJson.dependencies;
    const lockPackages = packageLock.packages;

    expect(
      dependencies !== null && !Array.isArray(dependencies) && typeof dependencies === 'object',
      'package.json 应声明 dependencies',
    ).toBe(true);
    expect(
      lockPackages !== null && !Array.isArray(lockPackages) && typeof lockPackages === 'object',
      'package-lock.json 应包含 packages 锁定信息',
    ).toBe(true);

    const rootLockPackage = (lockPackages as JsonObject)[''];
    expect(rootLockPackage).toBeDefined();
    expect((dependencies as JsonObject).antd).toEqual(expect.any(String));
    expect((dependencies as JsonObject)['@ant-design/icons']).toEqual(expect.any(String));
    expect(JSON.stringify(rootLockPackage)).toContain('antd');
    expect(JSON.stringify(rootLockPackage)).toContain('@ant-design/icons');
    expect(mainEntry).toContain("import 'antd/dist/reset.css';");
  });

  it('读取内置样例项目元数据时声明课程大实践 MBSE 建模工作台边界', () => {
    const metadata = readRequiredJsonObject(metadataPath, '天问二号样例项目元数据');
    const metadataText = collectStringEntries(metadata)
      .map(({ value }) => value)
      .join('\n');

    expect(metadata.id, '样例项目 ID 是面向工作台入口和工件引用的稳定公开标识').toBe(
      'tianwen-2',
    );
    expect(metadataText).toContain('天问二号');
    expect(metadataText).toContain('MBSE 建模工作台');
    expect(metadataText).toContain('基于模型的系统工程');
    expect(metadataText).toContain('课程大实践');
    expect(metadataText).toMatch(/独立于|不是.*小实验|不属于.*小实验|not.*lab/i);
    expect(metadataText.toLowerCase()).not.toContain('mbse-course-lab');
  });

  it('样例项目声明并提供源材料、SysML v2 文本和 JSON 视图模型真实工件', () => {
    const metadata = readRequiredJsonObject(metadataPath, '天问二号样例项目元数据');
    const declaredFiles = collectDeclaredProjectFiles(metadata);

    const sourceMaterials = declaredFiles.filter(({ keyPath, value }) =>
      /source|material|materials|源材料|材料/i.test(`${keyPath}\n${value}`),
    );
    const sysmlArtifacts = declaredFiles.filter(({ keyPath, value }) =>
      /sysml|\.sysmlv?2?$/i.test(`${keyPath}\n${value}`),
    );
    const jsonViewModels = declaredFiles.filter(({ keyPath, value }) =>
      /json.*view|view.*json|视图模型|view-model|\.view\.json$/i.test(
        `${keyPath}\n${value}`,
      ),
    );

    expect(sourceMaterials.length, '元数据应声明至少一个真实源材料文件').toBeGreaterThan(0);
    expect(sysmlArtifacts.length, '元数据应声明最小 SysML v2 文本模型工件').toBeGreaterThan(0);
    expect(jsonViewModels.length, '元数据应声明 JSON 视图模型工件').toBeGreaterThan(0);

    expect(sourceMaterials.map(({ content }) => content).join('\n')).toMatch(
      /天问二号|Tianwen-2|探测器|小行星|彗星|任务|需求/,
    );
    expect(sysmlArtifacts.map(({ content }) => content).join('\n')).toMatch(
      /package\s+|requirement|part def|action def|SysML v2|天问二号|Tianwen-2/i,
    );

    for (const viewModel of jsonViewModels) {
      const parsedViewModel: unknown = JSON.parse(viewModel.content);
      const viewModelText = JSON.stringify(parsedViewModel);

      expect(viewModelText).toMatch(/天问二号|Tianwen-2|tianwen-2/i);
      expect(viewModelText).toMatch(/views?|视图|nodes?|edges?|requirements?|工件/i);
    }
  });

  it('工作台入口呈现项目主页和内置样例资源树', () => {
    render(React.createElement(App));

    expect(
      screen.getByRole('heading', { name: /MBSE 建模工作台/ }),
    ).toBeVisible();
    expectVisibleText(/课程大实践项目入口/, '课程大实践入口文案');
    expect(screen.getByLabelText(/项目主页工作区/)).toBeVisible();
    expect(screen.getByLabelText(/项目资源树/)).toBeVisible();
    expect(screen.getByLabelText(/模型工件资源树/)).toBeVisible();
    expect(screen.getByRole('button', { name: /打开内置天问二号样例项目/ })).toBeVisible();
    expectVisibleText(/Tauri 桌面壳已运行/, 'Tauri 桌面壳运行入口提示');
  });

  it('工作台不把一次性导入和确认向导做成常驻导航或页签', () => {
    render(React.createElement(App));

    expect(screen.queryByRole('navigation', { name: /工作台模块导航/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/打开的工作区标签/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^源材料$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^确认向导$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^视图入口$/ })).not.toBeInTheDocument();
    expectVisibleText(/一次性新建\/更新项目流程/, '导入材料后续流程说明');
    expectVisibleText(/确认完成后回到项目工作台/, '确认向导后续流程说明');
  });
});
