import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { extractTianwen2ConfirmedData, generateTianwen2ModelArtifacts, validateViewModel } from '../src/domain/modelGeneration';
import type { ModelGenerationResult } from '../src/domain/modelGeneration';
import { createAgentSidecarClient } from '../src/domain/agentSidecar';
import type { AgentModelingSession, AgentSidecarEvent, AgentSidecarStatus } from '../src/domain/agentSidecar';
import App from '../src/App';

const tauriInvokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriInvokeMock,
}));

type InvokeCall = {
  command: string;
  args?: Record<string, unknown>;
};

const sourceText = [
  '天问二号任务面向小行星取样返回和主带彗星探测。',
  'REQ-TW2-001：任务应支持对目标小行星开展近距离探测并完成取样返回。',
  'REQ-TW2-004：探测器应通过测控通信分系统完成深空测控、数据下传和遥测接收。',
  '航天器平台应为载荷、推进、能源、热控和测控通信分系统提供统一承载。',
].join('\n');

function createValidAgentDraft(): ModelGenerationResult {
  return generateTianwen2ModelArtifacts(extractTianwen2ConfirmedData(sourceText));
}

function requireEvent<TType extends AgentSidecarEvent['type']>(
  events: AgentSidecarEvent[],
  type: TType,
): Extract<AgentSidecarEvent, { type: TType }> {
  const event = events.find((candidate) => candidate.type === type);

  expect(event, `建模会话应包含 ${type} 结构化事件`).toBeDefined();

  return event as Extract<AgentSidecarEvent, { type: TType }>;
}

describe('Agent Sidecar 客户端契约', () => {
  it('通过 Tauri invoke 管理 Sidecar 生命周期并返回运行状态', async () => {
    const calls: InvokeCall[] = [];
    const runningStatus: AgentSidecarStatus = {
      state: 'running',
      pid: 4242,
      endpoint: 'http://127.0.0.1:4157',
    };
    const observedStatus: AgentSidecarStatus = {
      state: 'running',
      pid: 4242,
      endpoint: 'http://127.0.0.1:4157',
    };
    const stoppedStatus: AgentSidecarStatus = {
      state: 'stopped',
      pid: null,
      endpoint: null,
    };
    const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });

      if (command === 'start_agent_sidecar') {
        return runningStatus as T;
      }

      if (command === 'agent_sidecar_status') {
        return observedStatus as T;
      }

      if (command === 'stop_agent_sidecar') {
        return stoppedStatus as T;
      }

      throw new Error(`未预期的 Tauri 命令：${command}`);
    };

    const client = createAgentSidecarClient({ invoke });

    await expect(client.start(), '启动入口应返回 Sidecar 已运行状态，供 UI 展示和后续生成流程判断').resolves.toEqual(
      runningStatus,
    );
    await expect(client.status(), '状态入口应返回 Tauri 管理的当前 Sidecar 状态').resolves.toEqual(
      observedStatus,
    );
    await expect(client.stop(), '停止入口应返回 Sidecar 已停止状态，不能只触发 fire-and-forget 命令').resolves.toEqual(
      stoppedStatus,
    );

    expect(
      calls.map((call) => call.command),
      '生命周期客户端必须调用 issue #4 约定的 Tauri command 名称，而不是绕过 Tauri 管理 Sidecar',
    ).toEqual(['start_agent_sidecar', 'agent_sidecar_status', 'stop_agent_sidecar']);
    expect(calls.every((call) => call.args === undefined), '生命周期命令不应伪造源材料参数').toBe(true);
  });

  it('抽取候选时只返回可确认的结构化抽取事件而不是模型草案', async () => {
    const calls: InvokeCall[] = [];
    const confirmedData = extractTianwen2ConfirmedData(sourceText);
    const events: AgentSidecarEvent[] = [
      { type: 'progress', message: 'Sidecar 已完成源材料切分', percent: 25 },
      { type: 'extraction', message: '已抽取确认候选项', confirmedData },
      { type: 'error', message: '演示用可展示错误：某段材料缺少需求编号', recoverable: true },
    ];
    const session = {
      sessionId: 'agent-extraction-session-issue-4',
      events,
      stdout: '{"events":[{"type":"progress","message":"来自 stdout 的错误进度"}]}',
    } satisfies AgentModelingSession & { stdout: string };
    const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });

      if (command === 'extract_agent_candidates') {
        return session as T;
      }

      throw new Error(`未预期的 Tauri 命令：${command}`);
    };

    const client = createAgentSidecarClient({ invoke });
    const result = await client.extractCandidates(sourceText);

    expect(calls, '抽取候选必须走 issue #4 约定的 Tauri command，并把用户源材料原文交给 Sidecar').toEqual([
      { command: 'extract_agent_candidates', args: { sourceText } },
    ]);
    expect(Array.isArray(result.events), '建模会话应暴露结构化事件数组，UI 不应从 stdout 字符串反解状态').toBe(true);
    expect(result.events.map((event) => event.type), '抽取阶段应只返回进度、抽取结果和可展示错误，不应提前生成模型草案').toEqual(
      expect.arrayContaining(['progress', 'extraction', 'error']),
    );
    expect(result.events.map((event) => event.type)).not.toContain('model-draft');

    const progressEvent = requireEvent(result.events, 'progress');
    const extractionEvent = requireEvent(result.events, 'extraction');
    const errorEvent = requireEvent(result.events, 'error');

    expect(progressEvent.message, '进度文案应来自结构化 progress 事件字段，而不是 stdout 文本').toBe(
      'Sidecar 已完成源材料切分',
    );
    expect(extractionEvent.confirmedData.requirements.map((requirement) => requirement.id), '抽取事件应携带可确认的结构化需求数据').toEqual(
      expect.arrayContaining(['REQ-TW2-001', 'REQ-TW2-004']),
    );
    expect(errorEvent.message, '错误事件应携带可直接展示给用户的错误说明').toContain('缺少需求编号');
  });

  it('用户确认抽取结果后才请求模型草案', async () => {
    const calls: InvokeCall[] = [];
    const confirmedData = extractTianwen2ConfirmedData(sourceText);
    const draft = createValidAgentDraft();
    const session: AgentModelingSession = {
      sessionId: 'agent-draft-session-issue-4',
      events: [
        { type: 'progress', message: '已生成模型草案', percent: 80 },
        { type: 'model-draft', message: '已生成可校验模型草案', draft },
      ],
    };
    const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });

      if (command === 'generate_agent_model_draft') {
        return session as T;
      }

      throw new Error(`未预期的 Tauri 命令：${command}`);
    };

    const client = createAgentSidecarClient({ invoke });
    const result = await client.generateDraft(sourceText, confirmedData);
    const modelDraftEvent = requireEvent(result.events, 'model-draft');

    expect(calls, '生成草案必须在用户确认抽取结果后传入 confirmedData，不能把抽取和草案合成一步').toEqual([
      { command: 'generate_agent_model_draft', args: { sourceText, confirmedData } },
    ]);
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining(['progress', 'model-draft']));
    expect(result.events.map((event) => event.type)).not.toContain('extraction');
    expect(modelDraftEvent.draft.sysmlText, '模型草案事件应携带可渲染的 SysML v2 文本模型').toContain('package');
  });

  it('模型草案事件携带的 JSON 视图模型通过校验并包含 requirements 与 bdd 视图', async () => {
    const confirmedData = extractTianwen2ConfirmedData(sourceText);
    const draft = createValidAgentDraft();
    const session: AgentModelingSession = {
      sessionId: 'agent-session-valid-draft',
      events: [
        {
          type: 'model-draft',
          message: '已生成模型草案',
          draft,
        },
      ],
    };
    const invoke = async <T,>(command: string): Promise<T> => {
      if (command === 'generate_agent_model_draft') {
        return session as T;
      }

      throw new Error(`未预期的 Tauri 命令：${command}`);
    };

    const client = createAgentSidecarClient({ invoke });
    const result = await client.generateDraft(sourceText, confirmedData);
    const modelDraftEvent = requireEvent(result.events, 'model-draft');

    const validation = validateViewModel(modelDraftEvent.draft.viewModel);

    expect(validation.valid, 'Agent 生成的草案 viewModel 应通过既有视图模型校验器，不能让 UI 接收坏引用').toBe(true);
    expect(validation.errors, '有效 Agent 草案不应产生 schema 或引用错误').toEqual([]);
    expect(
      modelDraftEvent.draft.viewModel.views.map((view) => view.kind),
      'Agent 草案必须同时提供需求视图与 BDD 结构视图，确认后才能复用 #3 的展示工作台',
    ).toEqual(expect.arrayContaining(['requirements', 'bdd']));
  });
});

function mockTauriSidecarForUi() {
  const confirmedData = extractTianwen2ConfirmedData(sourceText);
  const draft = generateTianwen2ModelArtifacts(confirmedData);
  const extractionSession: AgentModelingSession = {
    sessionId: 'ui-agent-extraction-session',
    events: [
      { type: 'progress', message: 'Sidecar 已接收源材料并开始抽取候选项。', percent: 20 },
      { type: 'extraction', message: '已抽取确认候选项。', confirmedData },
    ],
  };
  const draftSession: AgentModelingSession = {
    sessionId: 'ui-agent-draft-session',
    events: [
      { type: 'progress', message: '已生成 SysML v2 与视图模型草案。', percent: 80 },
      { type: 'model-draft', message: '模型草案已通过基础 schema 与引用校验。', draft },
    ],
  };

  tauriInvokeMock.mockImplementation(async (command: string) => {
    if (command === 'agent_sidecar_status') return { state: 'stopped', pid: null, endpoint: null };
    if (command === 'start_agent_sidecar') return { state: 'running', pid: 4242, endpoint: 'local://agent-sidecar/test' };
    if (command === 'extract_agent_candidates') return extractionSession;
    if (command === 'generate_agent_model_draft') return draftSession;
    if (command === 'stop_agent_sidecar') return { state: 'stopped', pid: null, endpoint: null };
    throw new Error(`未预期的 Tauri 命令：${command}`);
  });
}

describe('Agent Sidecar 用户路径契约', () => {
  it('工作台提供启动停止入口，并允许用户确认或拒绝 Agent 输出后复用模型展示区', async () => {
    mockTauriSidecarForUi();
    render(React.createElement(App));

    expect(screen.getByText(/Agent Sidecar 状态/), '工作台应显式展示 Agent Sidecar 运行状态').toBeVisible();
    expect(screen.getByRole('button', { name: /启动 Agent Sidecar/ }), '用户应能从工作台启动本地 Agent Sidecar').toBeEnabled();
    expect(screen.getByRole('button', { name: /停止 Agent Sidecar/ }), '用户应能从工作台停止本地 Agent Sidecar').toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /新建项目 \/ 导入材料|导入材料|使用 Agent 生成模型草案/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /源材料|材料内容|粘贴/ }), {
      target: { value: sourceText },
    });
    fireEvent.click(screen.getByRole('button', { name: /抽取候选|调用 Agent/ }));

    const dialog = await screen.findByRole('dialog', { name: /材料导入与确认向导/ });

    expect(within(dialog).getByRole('button', { name: /确认 Agent 输出并生成模型草案/ }), '用户必须先确认 Agent 抽取结果，再生成模型草案').toBeEnabled();
    expect(within(dialog).getByRole('button', { name: /拒绝 Agent 输出/ }), '用户必须能拒绝 Agent 输出并返回人工确认路径').toBeEnabled();

    fireEvent.click(within(dialog).getByRole('button', { name: /确认 Agent 输出并生成模型草案/ }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /^确认 Agent 输出$/ }));

    expect(await screen.findByText(/SysML v2 文本/), '确认 Agent 输出后应复用 #3 的 SysML v2 展示区').toBeVisible();
    expect(screen.getByText(/JSON 视图模型/), '确认 Agent 输出后应复用 #3 的 JSON 视图模型展示区').toBeVisible();
    expect(screen.getByText(/需求视图/), '确认 Agent 输出后应复用 #3 的需求视图').toBeVisible();
    expect(screen.getByText(/BDD 结构视图/), '确认 Agent 输出后应复用 #3 的 BDD 结构视图').toBeVisible();
    expect(screen.getByText(/Schema 校验通过/), '确认 Agent 输出后应展示 schema 校验通过标签').toBeVisible();
    expect(screen.getByText(/引用校验通过/), '确认 Agent 输出后应展示引用校验通过标签').toBeVisible();
  });
});
