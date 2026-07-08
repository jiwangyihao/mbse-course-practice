import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, normalize, resolve } from 'node:path';
import process from 'node:process';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { extractTianwen2ConfirmedData, generateTianwen2ModelArtifacts } from '../src/domain/modelGeneration';
import App from '../src/App';

const tauriInvokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriInvokeMock,
}));

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
const appEntryPath = resolve(repoRoot, 'src/App.tsx');
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

  it('ADR 0010 要求需求视图和 BDD 结构视图接入 React Flow 与 ELK 自动布局', () => {
    const appEntry = readRequiredTextFile(appEntryPath, 'App 前端入口');
    const mainEntry = readRequiredTextFile(mainEntryPath, 'React 入口');
    const reactFlowImport = appEntry.match(/import\s*{(?<imports>[\s\S]*?)}\s*from\s*['"]@xyflow\/react['"]/);
    const reactFlowImports = reactFlowImport?.groups?.imports ?? '';

    expect(reactFlowImport, 'ADR 0010 禁止自研绝对定位 div 画布伪装，App 必须从 @xyflow/react 接入图渲染能力').not.toBeNull();
    expect(reactFlowImports, 'App 应直接接入 React Flow 画布组件，而不是只保留依赖声明').toMatch(/\bReactFlow\b/);
    expect(reactFlowImports, 'App 应接入 React Flow 上下文，保证节点、边和视口由 React Flow 管理').toMatch(/\bReactFlowProvider\b/);
    expect(reactFlowImports, 'App 应接入 React Flow 的视口辅助能力，避免退回静态 div 列表').toMatch(/\b(?:Background|Controls)\b/);
    expect(appEntry, 'ADR 0010 要求图形布局 seam 显式接入 elkjs').toMatch(/from\s*['"]elkjs(?:\/lib\/elk\.bundled(?:\.js)?)?['"]|require\(['"]elkjs(?:\/lib\/elk\.bundled(?:\.js)?)?['"]\)/);
    expect(appEntry, '需求视图和 BDD 结构视图应通过 ELK 自动布局，而不是硬编码 position 坐标').toMatch(/\belk\.layout\s*\(/);
    expect(mainEntry, 'React Flow 样式基线必须在公共入口加载，否则节点、边和视口控件会退化').toContain("import '@xyflow/react/dist/style.css';");
  });

  it('IBD React Flow 连接使用 sourcePort 和 targetPort 作为具体 handle 锚点', () => {
    const appEntry = readRequiredTextFile(appEntryPath, 'App 前端入口');
    const edgeMapping = appEntry.match(/diagramConnections\.map\(\(edge\)\s*=>\s*\(\{(?<body>[\s\S]*?)\}\)\s*,?\s*\)/);
    const edgeMappingBody = edgeMapping?.groups?.body ?? '';

    expect(edgeMapping, 'IBD/图视图必须把连接映射为 React Flow edge 对象，不能只渲染文本列表').not.toBeNull();
    expect(edgeMappingBody, 'React Flow edge 仍应连接 source 节点').toMatch(/\bsource\s*:\s*edge\.source\b/);
    expect(edgeMappingBody, 'React Flow edge 仍应连接 target 节点').toMatch(/\btarget\s*:\s*edge\.target\b/);
    expect(
      edgeMappingBody,
      'IBD 连接必须把 sourcePort 传给 React Flow sourceHandle，让边锚定到具体源端口，而不是只写进 label',
    ).toMatch(/\bsourceHandle\s*:\s*edge\.sourcePort\b/);
    expect(
      edgeMappingBody,
      'IBD 连接必须把 targetPort 传给 React Flow targetHandle，让边锚定到具体目标端口，而不是只写进 label',
    ).toMatch(/\btargetHandle\s*:\s*edge\.targetPort\b/);
    expect(edgeMappingBody, '端口可以作为可读标签补充展示，但不能替代 React Flow handle 锚点').toMatch(/\blabel\s*:\s*formatDiagramEdgeLabel\(edge\)/);
  });

  it('IBD 端口渲染同时合并 view.ports 与 node.ports', () => {
    const appEntry = readRequiredTextFile(appEntryPath, 'App 前端入口');
    const portCollector = appEntry.match(/function\s+collectDiagramPorts[\s\S]*?\n}\s*\n\s*function\s+formatDiagramEdgeLabel/);
    const portCollectorBody = portCollector?.[0] ?? '';
    const mergesViewAndNodePorts = /for\s*\([^)]*of\s*\[\s*\.\.\.viewPorts\s*,\s*\.\.\.nodePorts\s*\]/.test(portCollectorBody);

    expect(portCollector, 'App 必须保留 collectDiagramPorts 端口收集入口，用于展示部件端口').not.toBeNull();
    expect(portCollectorBody, 'IBD 端口收集必须从 view.ports 派生 viewPorts，兼容视图级端口声明').toMatch(/\bviewPorts\s*=\s*view\.kind\s*===\s*['"]ibd['"][\s\S]*\bview\.ports\b/);
    expect(portCollectorBody, 'IBD 端口收集必须从 node.ports 派生 nodePorts，兼容合法的节点级端口声明').toMatch(/\bnodePorts\s*=[\s\S]*\bnode\.ports\b/);
    expect(
      mergesViewAndNodePorts,
      '端口列表必须在 collectDiagramPorts 中用 [...viewPorts, ...nodePorts] 合并；只读 view.ports 会让合法 node-scoped IBD 视图通过校验但 UI 不显示端口',
    ).toBe(true);
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

  it('导入天问二号材料后确认生成需求视图、BDD 结构视图、活动图和需求追溯矩阵', async () => {
    render(React.createElement(App));

    const importButton = screen.getByRole('button', { name: /新建项目 \/ 导入材料（#3）/ });
    expect(importButton, '导入材料入口应可点击，不能停留在 #2 的禁用占位按钮').toBeEnabled();

    fireEvent.click(importButton);

    expect(screen.getByRole('dialog', { name: /材料导入与确认向导/ })).toBeVisible();
    expect(screen.getByText(/一次性确认向导/)).toBeVisible();

    const sourceMaterial = [
      '天问二号任务面向小行星取样返回和主带彗星探测。',
      'REQ-TW2-001：任务应支持对目标小行星开展近距离探测并完成取样返回。',
      'REQ-TW2-003：电源与热控分系统应在深空飞行和近距离探测阶段提供能源与热环境保障。',
      'REQ-TW2-004：探测器应通过测控通信分系统完成深空测控、数据下传和遥测接收。',
      '电源与热控分系统应在深空巡航期间维持安全能源与热控边界。',
      '航天器平台应为载荷、推进、能源、热控和测控通信分系统提供统一承载。',
    ].join('\n');
    const confirmedData = extractTianwen2ConfirmedData(sourceMaterial);
    const draft = generateTianwen2ModelArtifacts(confirmedData);
    tauriInvokeMock.mockImplementation(async (command: string) => {
      if (command === 'start_agent_sidecar') return { state: 'running', pid: 4242, endpoint: 'local://agent-sidecar/test' };
      if (command === 'extract_agent_candidates') {
        return {
          sessionId: 'contract-extraction-session',
          events: [
            { type: 'progress', message: 'Sidecar 已接收源材料并开始抽取候选项。', percent: 20 },
            { type: 'extraction', message: '已抽取确认候选项。', confirmedData },
            {
              type: 'suggestion',
              message: '修正建议：请补全 REQ-TW2-004 与测控通信分系统的材料出处。',
              target: 'extraction',
              recommendation: '确认抽取结果前，请检查 REQ-TW2-004 的追溯关系是否覆盖测控通信分系统。',
              severity: 'warning',
            },
          ],
        };
      }
      if (command === 'generate_agent_model_draft') {
        return {
          sessionId: 'contract-draft-session',
          events: [
            { type: 'progress', message: '已生成 SysML v2 与视图模型草案。', percent: 80 },
            { type: 'model-draft', message: '模型草案已通过基础 schema 与引用校验。', draft },
            {
              type: 'suggestion',
              message: '修正建议：模型草案需复核 BDD 结构视图中的追溯覆盖。',
              target: 'model-draft',
              recommendation: '确认最终草案前，请复核需求视图到 BDD 结构视图的追溯覆盖。',
              severity: 'info',
            },
          ],
        };
      }
      throw new Error(`未预期的 Tauri 命令：${command}`);
    });

    fireEvent.change(screen.getByRole('textbox', { name: /源材料|材料内容|粘贴/ }), {
      target: { value: sourceMaterial },
    });
    fireEvent.click(screen.getByRole('button', { name: /抽取候选|生成候选|开始抽取/ }));

    expect(await screen.findByText(/候选使命/)).toBeVisible();
    expect(screen.getByText(/候选需求/)).toBeVisible();
    expect(screen.getByText(/候选分系统/)).toBeVisible();
    expect(screen.getByText(/REQ-TW2-001/)).toBeVisible();
    expect(screen.getAllByText(/REQ-TW2-004/).length).toBeGreaterThan(0);
    expect(screen.getByText(/航天器平台/)).toBeVisible();
    expect(screen.getAllByText(/测控通信分系统/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^修正建议$/)).toBeVisible();
    expect(screen.getByText(/^warning$/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /确认 Agent 输出并生成模型草案/ }));
    expect(await screen.findByText(/^info$/)).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: /^确认 Agent 输出$/ }));

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /材料导入与确认向导/ }),
        '确认 Agent 输出后导入对话框应关闭，后续 #5 断言必须来自项目工作区而不是源材料文本框',
      ).not.toBeInTheDocument();
    });
    const generatedWorkspace = screen.getByText(/SysML v2 文本/).closest('.generated-workspace');
    expect(generatedWorkspace, '确认后应进入生成模型工作区，#5 断言只在该区域内检查').not.toBeNull();
    const workspace = within(generatedWorkspace as HTMLElement);

    expect(workspace.getByText(/SysML v2 文本/)).toBeVisible();
    expect(workspace.getByText(/JSON 视图模型/)).toBeVisible();
    expect(workspace.getByText(/需求视图/)).toBeVisible();
    expect(workspace.getByText(/BDD 结构视图/)).toBeVisible();
    expect(workspace.getByLabelText(/需求视图 自动布局图/)).toBeVisible();
    expect(workspace.getByLabelText(/BDD 结构视图 自动布局图/)).toBeVisible();
    expect(workspace.getByText(/活动图/), 'issue #5 验收要求确认后在工作区展示活动图入口，而不是只生成 JSON 数据').toBeVisible();
    expect(workspace.getByLabelText(/活动图 自动布局图/), '活动图必须通过用户可见的自动布局图画布渲染').toBeVisible();
    expect(
      workspace.getAllByText(/活动流|flow|取样返回|数据下传|深空.*(巡航|安全|维持)/).length,
      '活动图区域必须展示活动流相关文案或行为名称，证明用户能理解活动节点之间的流转',
    ).toBeGreaterThan(0);
    expect(workspace.getByText(/需求追溯矩阵/), 'issue #5 验收要求确认后展示需求追溯矩阵').toBeVisible();
    expect(workspace.getAllByText(/REQ-TW2-003/).length, '追溯矩阵必须展示能源与热控保障需求行').toBeGreaterThan(0);
    expect(workspace.getAllByText(/REQ-TW2-004/).length, '追溯矩阵必须展示深空测控通信需求行').toBeGreaterThan(0);
    expect(workspace.getAllByText(/结构元素|spacecraft-platform|ttc-communication|航天器平台|测控通信分系统/).length, '追溯矩阵必须展示结构列').toBeGreaterThan(0);
    expect(workspace.getAllByText(/行为元素|活动节点|取样返回|数据下传|深空.*(巡航|安全|维持)/).length, '追溯矩阵必须展示行为列').toBeGreaterThan(0);
    expect(workspace.getAllByText(/已覆盖/).length, '追溯矩阵必须把覆盖单元格以用户可读的已覆盖状态展示').toBeGreaterThan(0);
    expect(workspace.getAllByText(/未覆盖/).length, '追溯矩阵必须把缺口单元格以用户可读的未覆盖状态展示').toBeGreaterThan(0);
    expect(workspace.getAllByText(/覆盖校验/).length, '工作区顶部或矩阵区域必须展示覆盖校验状态，供用户发现未覆盖需求').toBeGreaterThan(0);
    expect(workspace.getByText(/自动布局/)).toBeVisible();
    expect(workspace.getByText(/Schema 校验通过/)).toBeVisible();
    expect(workspace.getByText(/引用校验通过/)).toBeVisible();
  });
  it('确认生成后界面渲染只读 IBD 并声明不是完整拖拽式图编辑器', async () => {
    render(React.createElement(App));

    const sourceMaterial = [
      '天问二号任务面向小行星取样返回和主带彗星探测。',
      'REQ-TW2-001：任务应支持对目标小行星开展近距离探测并完成取样返回。',
      'REQ-TW2-002：采样返回分系统应完成样品采集、封装、转移和返回舱交付。',
      'REQ-TW2-003：电源与热控分系统应在深空飞行和近距离探测阶段提供能源与热环境保障。',
      'REQ-TW2-004：探测器应通过测控通信分系统完成深空测控、数据下传和遥测接收。',
      '航天器平台应为采样返回、测控通信、电源与热控、制导导航与控制分系统提供统一承载。',
    ].join('\n');
    const confirmedData = extractTianwen2ConfirmedData(sourceMaterial);
    const draft = generateTianwen2ModelArtifacts(confirmedData);
    tauriInvokeMock.mockImplementation(async (command: string) => {
      if (command === 'start_agent_sidecar') return { state: 'running', pid: 4242, endpoint: 'local://agent-sidecar/ibd-test' };
      if (command === 'extract_agent_candidates') {
        return {
          sessionId: 'ibd-extraction-session',
          events: [
            { type: 'progress', message: 'Sidecar 已接收源材料并开始抽取候选项。', percent: 20 },
            { type: 'extraction', message: '已抽取确认候选项。', confirmedData },
          ],
        };
      }
      if (command === 'generate_agent_model_draft') {
        return {
          sessionId: 'ibd-draft-session',
          events: [{ type: 'model-draft', message: '模型草案已通过 IBD 静态校验。', draft }],
        };
      }
      throw new Error(`未预期的 Tauri 命令：${command}`);
    });

    fireEvent.click(screen.getByRole('button', { name: /新建项目 \/ 导入材料（#3）/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /源材料|材料内容|粘贴/ }), {
      target: { value: sourceMaterial },
    });
    fireEvent.click(screen.getByRole('button', { name: /抽取候选|生成候选|开始抽取/ }));
    expect(await screen.findByText(/候选使命/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /确认 Agent 输出并生成模型草案/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^确认 Agent 输出$/ }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /材料导入与确认向导/ })).not.toBeInTheDocument();
    });

    const generatedWorkspace = screen.getByText(/SysML v2 文本/).closest('.generated-workspace');
    expect(generatedWorkspace, '确认后应进入生成模型工作区，IBD 断言只在项目工作区检查').not.toBeNull();
    const workspace = within(generatedWorkspace as HTMLElement);

    const ibdCanvas = workspace.getByLabelText(/IBD|内部块图.*自动布局图/);
    expect(ibdCanvas, 'IBD 必须复用 React Flow 自动布局画布呈现').toBeVisible();
    const ibdCard = ibdCanvas.closest('.workspace-card');
    expect(ibdCard, '确认生成后工作区必须出现可定位的 IBD/内部块图视图卡片').not.toBeNull();
    const ibdWorkspace = within(ibdCard as HTMLElement);

    expect(ibdWorkspace.getByText(/^IBD 内部块图$/), '确认生成后 IBD 视图卡片标题必须保留领域术语').toBeVisible();
    expect(ibdWorkspace.getByText(/可视化\s*\+\s*静态校验|可视化.*静态校验/), '界面必须声明 IBD 当前边界是可视化 + 静态校验').toBeVisible();
    expect(
      ibdWorkspace.getByText(/不提供完整拖拽式图编辑|非完整图编辑器|不是完整.*图编辑器/),
      '界面必须明确 IBD 不是完整拖拽式图编辑器，避免把只读校验视图扩展成编辑器',
    ).toBeVisible();

    const appEntry = readRequiredTextFile(appEntryPath, 'App 前端入口');
    expect(appEntry, 'IBD 所在 React Flow 画布必须关闭节点拖拽，保持只读边界').toMatch(/nodesDraggable\s*=\s*\{false\}|nodesDraggable\s*:\s*false/);
    expect(appEntry, 'IBD 所在 React Flow 画布必须关闭用户连线，避免伪装成完整图编辑器').toMatch(/nodesConnectable\s*=\s*\{false\}|nodesConnectable\s*:\s*false/);
  });

});
