import React from 'react';
import applicationStyles from '../src/styles.css?inline';
import { createWorkbenchProjectState } from '../src/domain/workbenchProject';
import { loadBundledTianwen2Project } from '../src/domain/sampleProject';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import AgentExecutionTrace from '../src/AgentExecutionTrace';
import { useAgentTraceSessions } from '../src/useAgentTraceSessions';
import { createTraceCollector } from '../sidecar/agent-trace-protocol';
import { emitSidecarFailure } from '../sidecar/agent-sdk-sidecar-failure.mjs';
import { forwardSdkSessionEvent } from '../sidecar/agent-trace-protocol';
import { createAgentToolPolicyExtension, ensureRequiredToolsActive, MAX_INLINE_EVAL_CHARACTERS } from '../sidecar/agent-tool-policy.mjs';
import { createCandidateVerificationGate } from '../sidecar/candidate-verification-tool.mjs';
import { buildExtractionPrompt, collectResearchedSourceUrls, reconcileExtractionDisclosures, validateExtractionDisclosures } from '../sidecar/extraction-task.mjs';
import { buildWorkspaceModelingPrompt } from '../sidecar/modeling-task.mjs';
import App from '../src/App';
import {
  appendAgentEventsToSessions,
  createAgentSidecarClient,
  createLegacyAgentModelingSession,
  type AgentSidecarEventInput,
} from '../src/domain/agentSidecar';
import type { AgentSidecarEvent, AgentSidecarStatus } from '../src/domain/agentSidecar';
import { extractTianwen2ConfirmedData, validateViewModel } from '../src/domain/modelGeneration';
import type { ModelGenerationResult } from '../src/domain/modelGeneration';
import { loadNodeGeneratedDraft } from './helpers/generatedDraft';

const applicationStyleElement = document.createElement('style');
applicationStyleElement.textContent = applicationStyles;
document.head.append(applicationStyleElement);

const tauriInvokeMock = vi.hoisted(() => vi.fn());
const tauriListenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriInvokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriListenMock,
}));

beforeEach(() => {
  tauriInvokeMock.mockReset();
  tauriListenMock.mockReset();
  tauriListenMock.mockResolvedValue(() => undefined);
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

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
const longReasoningTail = 'TRACE_TAIL_1234567890_END';
const longReasoningDelta = `${'A'.repeat(4500)}${longReasoningTail}`;

async function createValidAgentDraft(sessionId = 'ui-agent-draft-session'): Promise<ModelGenerationResult> {
  const draft = await loadNodeGeneratedDraft();
  return {
    ...draft,
    provenance: {
      mode: 'sdk-agent',
      provider: 'test-provider',
      model: 'test-model',
      sdkSessionId: sessionId,
      completedAt: '2026-07-10T00:00:02.000Z',
      schemaOverridden: false,
      validationSummary: { valid: true, errorCount: 0, findingCount: 0 },
    },
  };
}

function requireEvent<TType extends AgentSidecarEvent['type']>(
  events: AgentSidecarEvent[],
  type: TType,
): Extract<AgentSidecarEvent, { type: TType }> {
  const event = events.find((candidate) => candidate.type === type);
  expect(event).toBeDefined();
  return event as Extract<AgentSidecarEvent, { type: TType }>;
}

type TauriEventHandler = (event: { payload: AgentSidecarEvent }) => void;

function enableTauriRuntime() {
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
}

function createTraceSession(sessionId: string, events: AgentSidecarEventInput[], completedAt: string) {
  return createLegacyAgentModelingSession({
    sessionId,
    events,
    provider: 'test-provider',
    model: 'test-model',
    completedAt,
  });
}

function openTracePhase(title: string, occurrence = 0) {
  const phaseLabels = screen.getAllByText(title);
  expect(phaseLabels[occurrence]).toBeDefined();
  fireEvent.click(phaseLabels[occurrence]!);
}

function openTraceDebug(occurrence = 0) {
  const debugLabels = screen.getAllByText('事件调试');
  expect(debugLabels[occurrence]).toBeDefined();
  fireEvent.click(debugLabels[occurrence]!);
}

function installDeferredEventStream() {
  let handler: TauriEventHandler | null = null;
  const {
    promise: registrationBarrier,
    resolve: releaseRegistration,
  } = Promise.withResolvers<void>();
  tauriListenMock.mockImplementation(async (_eventName: string, nextHandler: TauriEventHandler) => {
    await registrationBarrier;
    handler = nextHandler;
    return () => {
      handler = null;
    };
  });
  return {
    releaseRegistration() {
      releaseRegistration();
    },
    emit(payload: AgentSidecarEvent) {
      handler?.({ payload });
    },
  };
}

function buildDesktopInvoke(extraHandlers: Record<string, unknown>) {
  return async (command: string) => {
    if (command === 'agent_sidecar_status') return { state: 'stopped', pid: null, endpoint: null };
    if (command === 'load_workbench_project') {
      throw new Error('工作台项目状态文件不存在');
    }
    if (command === 'save_workbench_project') {
      return {
        projectRoot: null,
        savedAt: null,
        manifestPath: 'sample-projects/tianwen-2/project.json',
        manifest: { id: 'tianwen-2', name: '天问二号探测器样例项目', caseName: '天问二号探测器', workspaceBoundary: '独立工作区' },
        sourceMaterials: [],
        modelArtifacts: [],
        confirmedData: null,
        generatedArtifacts: null,
        sidecarDraft: null,
        agentTraceSessions: null,
        lastExportedBundle: null,
        files: [],
      };
    }
    if (command === 'export_workbench_project') {
      return null;
    }
    if (command in extraHandlers) {
      return extraHandlers[command]!;
    }
    throw new Error(`未预期的 Tauri 命令：${command}`);
  };
}

describe('Agent Sidecar 客户端契约', () => {
  it('通过 Tauri invoke 管理 Sidecar 生命周期并返回运行状态', async () => {
    const calls: InvokeCall[] = [];
    const runningStatus: AgentSidecarStatus = { state: 'running', pid: 4242, endpoint: 'http://127.0.0.1:4157' };
    const observedStatus: AgentSidecarStatus = { state: 'running', pid: 4242, endpoint: 'http://127.0.0.1:4157' };
    const stoppedStatus: AgentSidecarStatus = { state: 'stopped', pid: null, endpoint: null };
    const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });
      if (command === 'start_agent_sidecar') return runningStatus as T;
      if (command === 'agent_sidecar_status') return observedStatus as T;
      if (command === 'stop_agent_sidecar') return stoppedStatus as T;
      throw new Error(`未预期的 Tauri 命令：${command}`);
    };

    const client = createAgentSidecarClient({ invoke });
    await expect(client.start()).resolves.toEqual(runningStatus);
    await expect(client.status()).resolves.toEqual(observedStatus);
    await expect(client.stop()).resolves.toEqual(stoppedStatus);
    expect(calls.map((call) => call.command)).toEqual(['start_agent_sidecar', 'agent_sidecar_status', 'stop_agent_sidecar']);
    expect(calls.every((call) => call.args === undefined)).toBe(true);
  });

  it('把叙述材料作为开放式建模起点，并要求候选落盘后再校验', () => {
    const material = loadBundledTianwen2Project().sourceMaterials[0]?.content ?? '';
    const candidatePath = 'C:\\Temp\\mbse-agent-candidate-test\\output\\confirmed-data.json';
    const prompt = buildExtractionPrompt(material, candidatePath);

    expect(prompt).toContain(material);
    expect(prompt).toContain(candidatePath);
    expect(prompt).toMatch(/开放式.*建模|系统工程.*推理/);
    expect(prompt).toMatch(/检索结果.*不是.*候选工件|不是.*候选工件.*检索结果/);
    expect(prompt).toMatch(/write.*绝对路径|绝对路径.*write/);
    expect(prompt).toMatch(/edit.*修改|修改.*edit/);
    expect(prompt).toMatch(/verify_candidate.*空对象 \{\}|空对象 \{\}.*verify_candidate/);
    expect(prompt).toMatch(/yield.*result: \{ data: \{ suggestions: \[\.\.\.\] \} \}/s);
    expect(prompt).toMatch(/省略 type/);
    expect(prompt).toMatch(/禁止.*type: \["suggestions"\].*非终止/s);
    expect(prompt).toMatch(/yield 成功后.*立即中断.*Agent 会话/s);
    expect(prompt).toMatch(/外部资料|公开资料/);
    expect(prompt).toMatch(/建模假设/);
    expect(prompt).toMatch(/待确认/);
    expect(prompt).toMatch(/置信度/);
    expect(prompt).toMatch(/稳定 ID|稳定标识/);
    expect(prompt).not.toContain('必须只基于材料内容');
    expect(prompt).not.toContain('若材料不足以形成完整候选，请调用 yield 返回 error');
    expect(prompt).toMatch(/不要.*eval.*长|长.*脚本.*scratch\/scripts\//);
  });

  it('工作区建模明确绝对输出路径、文件工具和早期 verify', () => {
    const material = loadBundledTianwen2Project().sourceMaterials[0]?.content ?? '';
    const workspaceRoot = 'C:\\Temp\\mbse-agent-workspace-test';
    const prompt = buildWorkspaceModelingPrompt(extractTianwen2ConfirmedData(material), workspaceRoot);

    expect(prompt).toContain('C:\\Temp\\mbse-agent-workspace-test\\output\\model.sysml');
    expect(prompt).toMatch(/write.*绝对路径|绝对路径.*write/s);
    expect(prompt).toMatch(/edit.*修改|修改.*edit/s);
    expect(prompt).toMatch(/当前最好的一版 SysML.*尽早.*写入|尽早.*写入.*SysML/);
    expect(prompt).toMatch(/verify.*不是.*前置门槛|不是.*满足.*条件.*才.*verify/);
    expect(prompt).toMatch(/即使.*不完整.*verify|verify.*即使.*不完整/);
    expect(prompt).toMatch(/不要.*Python.*(?:复刻|替代).*verify/);
    expect(prompt).toMatch(/eval.*短小|短小.*eval/);
    expect(prompt).toMatch(/scratch\/scripts\/.*\.py/);
    expect(prompt).toMatch(/scratch\/(?:data|logs|notes)/);
    expect(prompt).toMatch(/INVALID_SYSML.*参数 \{\}.*正确.*编辑指定/s);
    expect(prompt).not.toContain('完成初稿后调用 verify');
  });

  it('阻止超长 eval 并指导 Agent 将脚本落盘后用短命令执行', async () => {
    const handlers = new Map();
    createAgentToolPolicyExtension({
      on: (event, handler) => handlers.set(event, handler),
    });
    const handler = handlers.get('tool_call');

    await expect(handler({
      toolName: 'eval',
      input: { language: 'py', code: 'print(1)' },
    })).resolves.toBeUndefined();
    const blocked = await handler({
      toolName: 'eval',
      input: { language: 'py', code: 'x'.repeat(MAX_INLINE_EVAL_CHARACTERS + 1) },
    });
    expect(blocked).toMatchObject({ block: true });
    expect(blocked.reason).toMatch(/scratch\/scripts\/.*bash.*短命令/s);
    expect(blocked.reason).toMatch(/verify_candidate.*verify/s);
  });

  it('候选校验只读取固定文件，缺失时返回绝对路径和 write 指令', async () => {
    const candidatePath = 'C:\\Temp\\missing-candidate-workspace\\output\\confirmed-data.json';
    const gate = createCandidateVerificationGate({
      candidatePath,
      validateConfirmedData: () => {
        throw new Error('不应在文件缺失时校验对象。');
      },
    });

    expect(gate.tool.name).toBe('verify_candidate');
    expect(gate.tool.description).toMatch(/参数.*空对象 \{\}.*固定.*confirmed-data\.json/s);
    const missing = await gate.tool.execute('missing-candidate', {});
    expect(missing.details).toMatchObject({
      valid: false,
      status: 'candidate-file-missing',
      candidatePath,
      invocationAccepted: true,
    });
    expect(missing.content[0]?.text).toContain(candidatePath);
    expect(missing.content[0]?.text).toMatch(/文件不存在.*write|write.*文件不存在/s);
    expect(missing.content[0]?.text).not.toMatch(/verify_candidate failed/i);
  });

  it('会话启动时强制激活本阶段必需校验工具', async () => {
    let activeToolNames = ['eval', 'yield'];
    const session = {
      getAllToolNames: () => ['eval', 'yield', 'verify_candidate'],
      getActiveToolNames: () => activeToolNames,
      setActiveToolsByName: vi.fn(async (toolNames: string[]) => {
        activeToolNames = toolNames;
      }),
    };

    await expect(ensureRequiredToolsActive(session, ['verify_candidate', 'yield']))
      .resolves.toEqual(['eval', 'yield', 'verify_candidate']);
    expect(session.setActiveToolsByName).toHaveBeenCalledWith(['eval', 'yield', 'verify_candidate']);
  });
  it('候选抽取 SDK 会话开放全部 OMP 内置工具', async () => {
    const previousAgentModel = process.env.MBSE_AGENT_MODEL;
    delete process.env.MBSE_AGENT_MODEL;
    let activeToolNames = ['eval', 'yield'];
    const session = {
      sessionId: 'tool-registration-session',
      model: { provider: 'test-provider', id: 'test-model' },
      dispose: vi.fn(async () => undefined),
      getAllToolNames: () => ['eval', 'yield', 'verify_candidate'],
      getActiveToolNames: () => activeToolNames,
      setActiveToolsByName: vi.fn(async (toolNames: string[]) => {
        activeToolNames = toolNames;
      }),
    };
    const createAgentSessionMock = vi.fn(async () => ({ session, modelFallbackMessage: null }));
    const discoverAuthStorageMock = vi.fn(async () => ({}));
    const inMemoryMock = vi.fn(() => ({}));

    vi.doMock('@oh-my-pi/pi-coding-agent', () => ({
      createAgentSession: createAgentSessionMock,
      discoverAuthStorage: discoverAuthStorageMock,
      ModelRegistry: class {
        async refresh() {}
        async getApiKey() {
          return 'test-api-key';
        }
      },
      SessionManager: { inMemory: inMemoryMock },
    }));

    const verifyCandidateTool = createCandidateVerificationGate({
      candidatePath: 'C:\\Temp\\candidate-session\\output\\confirmed-data.json',
      validateConfirmedData: () => undefined,
    }).tool;
    try {
      const { createSdkSession } = await import('../sidecar/agent-sdk-sidecar.mjs');
      const created = await createSdkSession({
        outputSchema: { type: 'object' },
        systemPrompt: '测试候选任务',
        allBuiltInTools: true,
        customTools: [verifyCandidateTool],
        extensions: [createAgentToolPolicyExtension],
        requiredToolNames: ['verify_candidate', 'yield'],
      });
      expect(created.activeToolNames).toEqual(['eval', 'yield', 'verify_candidate']);

      expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({
        modelPattern: 'openai-codex/gpt-5.6-sol',
        toolNames: undefined,
        enableMCP: false,
        enableLsp: true,
        skipPythonPreflight: false,
        customTools: [verifyCandidateTool],
        extensions: [createAgentToolPolicyExtension],
      }));
    } finally {
      vi.doUnmock('@oh-my-pi/pi-coding-agent');
      vi.resetModules();
      if (previousAgentModel === undefined) {
        delete process.env.MBSE_AGENT_MODEL;
      } else {
        process.env.MBSE_AGENT_MODEL = previousAgentModel;
      }
    }
  });

  it('外部资料候选必须携带可访问的 http(s) 来源', () => {
    const disclosure = {
      category: 'external-source',
      message: '采用公开任务资料细化使命。',
      recommendation: '请确认公开资料与课程场景一致。',
      severity: 'info',
      confidence: 'medium',
      sourceUrls: [],
      affectedElements: ['小行星采样需求'],
    };

    expect(() => validateExtractionDisclosures([disclosure])).toThrow(/至少一个实际检索来源/);
    expect(() => validateExtractionDisclosures([{
      ...disclosure,
      sourceUrls: ['file:///tmp/source.md'],
    }])).toThrow(/http 或 https/);
    expect(() => validateExtractionDisclosures([{
      ...disclosure,
      sourceUrls: ['https://www.cnsa.gov.cn/'],
    }])).not.toThrow();
    expect(() => validateExtractionDisclosures([{
      ...disclosure,
      sourceUrls: ['https://www.cnsa.gov.cn/'],
      confidence: 'certain',
    }])).toThrow(/confidence.*high.*medium.*low/);
    expect(() => validateExtractionDisclosures([{
      ...disclosure,
      sourceUrls: ['https://www.cnsa.gov.cn/'],
      affectedElements: [],
    }])).toThrow(/用户可读的候选对象名称/);
  });

  it('外部资料只能引用本次成功网页工具结果实际返回的链接', () => {
    const researchedSourceUrls = collectResearchedSourceUrls([
      {
        type: 'tool-call-start',
        toolName: 'read',
        payload: { args: { path: 'https://unread.example/spec' } },
      },
      {
        type: 'tool-call-end',
        toolName: 'read',
        isError: false,
        payload: {
          args: { path: 'C:/tmp/local-material.md' },
          result: { text: '本地材料仅提到 https://local-echo.example/not-researched' },
        },
      },
      {
        type: 'tool-call-end',
        toolName: 'read',
        isError: false,
        payload: {
          args: { path: 'https://standards.example/mbse' },
          result: { text: '正文外链：https://outgoing.example/not-read' },
        },
      },
      {
        type: 'tool-call-end',
        toolName: 'browser',
        isError: true,
        payload: { result: { url: 'https://failed.example/page' } },
      },
      {
        type: 'tool-call-end',
        toolName: 'web_search',
        isError: false,
        payload: {
          result: {
            results: [{ title: '国家航天局任务资料', url: 'https://www.cnsa.gov.cn/n6758823/index.html' }],
          },
        },
      },
    ]);
    const disclosure = {
      category: 'external-source',
      confidence: 'high',
      message: '采用公开任务资料细化使命。',
      recommendation: '请确认公开资料与课程场景一致。',
      severity: 'info',
      sourceUrls: ['https://www.cnsa.gov.cn/n6758823/index.html'],
      affectedElements: ['小行星采样需求'],
    };

    expect(researchedSourceUrls).toEqual(new Set([
      'https://standards.example/mbse',
      'https://www.cnsa.gov.cn/n6758823/index.html',
    ]));
    expect(() => validateExtractionDisclosures([disclosure], researchedSourceUrls)).not.toThrow();
    expect(() => validateExtractionDisclosures([{
      ...disclosure,
      sourceUrls: ['https://unread.example/spec'],
    }], researchedSourceUrls)).toThrow(/未由本次会话成功网页搜索或读取结果返回/);
    const [downgradedDisclosure] = reconcileExtractionDisclosures([{
      ...disclosure,
      sourceUrls: ['https://unread.example/spec'],
    }], researchedSourceUrls);
    expect(downgradedDisclosure).toMatchObject({
      category: 'engineering-assumption',
      confidence: 'low',
      sourceUrls: [],
    });
    expect(() => validateExtractionDisclosures([downgradedDisclosure], researchedSourceUrls)).not.toThrow();
  });


  it('抽取候选时只返回可确认的结构化抽取事件而不是模型草案', async () => {
    const calls: InvokeCall[] = [];
    const confirmedData = extractTianwen2ConfirmedData(sourceText);
    const session = createLegacyAgentModelingSession({
      sessionId: 'agent-extraction-session-issue-4',
      events: [
        { type: 'progress', message: 'Sidecar 已完成源材料切分', percent: 25 },
        {
          type: 'suggestion',
          message: '建议补全测控通信分系统与 REQ-TW2-004 的追溯关系',
          target: 'extraction',
          recommendation: '请确认 REQ-TW2-004 是否应追溯到测控通信分系统，并补充材料出处。',
          severity: 'warning',
        },
        { type: 'extraction', message: '已抽取确认候选项', confirmedData },
        { type: 'error', message: '演示用可展示错误：某段材料缺少需求编号', recoverable: true },
      ],
      provider: 'test-provider',
      model: 'test-model',
      completedAt: '2026-07-10T00:00:01.000Z',
    });
    const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });
      if (command === 'extract_agent_candidates') return session as T;
      throw new Error(`未预期的 Tauri 命令：${command}`);
    };

    const client = createAgentSidecarClient({ invoke });
    const result = await client.extractCandidates(sourceText);

    expect(calls).toEqual([{ command: 'extract_agent_candidates', args: { sourceText } }]);
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining(['progress', 'extraction', 'suggestion', 'error']));
    expect(result.events.map((event) => event.type)).not.toContain('model-draft');
    expect(requireEvent(result.events, 'extraction').confirmedData.requirements.map((requirement) => requirement.id)).toEqual(expect.arrayContaining(['REQ-TW2-001', 'REQ-TW2-004']));
  });

  it('用户确认抽取结果后才请求模型草案', async () => {
    const calls: InvokeCall[] = [];
    const confirmedData = extractTianwen2ConfirmedData(sourceText);
    const draft = await createValidAgentDraft();
    const session = createLegacyAgentModelingSession({
      sessionId: 'agent-draft-session-issue-4',
      events: [
        { type: 'progress', message: '已生成模型草案', percent: 80 },
        {
          type: 'suggestion',
          message: '建议补强需求到 BDD 模块的追溯覆盖',
          target: 'model-draft',
          recommendation: '请检查模型草案中 REQ-TW2-004 到测控通信分系统 block 的追溯覆盖是否完整。',
          severity: 'info',
        },
        { type: 'model-draft', message: '已生成可校验模型草案', draft },
      ],
      provider: 'test-provider',
      model: 'test-model',
      completedAt: '2026-07-10T00:00:02.000Z',
    });
    const invoke = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args });
      if (command === 'generate_agent_model_draft') return session as T;
      throw new Error(`未预期的 Tauri 命令：${command}`);
    };

    const client = createAgentSidecarClient({ invoke });
    const result = await client.generateDraft(sourceText, confirmedData);
    expect(calls).toEqual([{ command: 'generate_agent_model_draft', args: { sourceText, confirmedData } }]);
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining(['progress', 'suggestion', 'model-draft']));
    expect(result.events.map((event) => event.type)).not.toContain('extraction');
    expect(requireEvent(result.events, 'model-draft').draft.sourceSet.files.some((file) => file.content.includes('package'))).toBe(true);
  });

  it('模型草案事件携带的 JSON 视图模型通过校验并包含 requirements 与 bdd 视图', async () => {
    const confirmedData = extractTianwen2ConfirmedData(sourceText);
    const draft = await createValidAgentDraft();
    const session = createLegacyAgentModelingSession({
      sessionId: 'agent-session-valid-draft',
      events: [{ type: 'model-draft', message: '已生成模型草案', draft }],
      provider: 'test-provider',
      model: 'test-model',
      completedAt: '2026-07-10T00:00:02.000Z',
    });
    const invoke = async <T,>(command: string): Promise<T> => {
      if (command === 'generate_agent_model_draft') return session as T;
      throw new Error(`未预期的 Tauri 命令：${command}`);
    };

    const client = createAgentSidecarClient({ invoke });
    const result = await client.generateDraft(sourceText, confirmedData);
    const validation = validateViewModel(requireEvent(result.events, 'model-draft').draft.viewModel);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });
  it('实时事件按会话增量追加且不重建未变化的历史会话', () => {
    const historicalSession = createTraceSession(
      'historical-session',
      [{ type: 'progress', message: '历史进度', percent: 100 }],
      '2026-07-13T00:00:00.000Z',
    );
    const liveSession = createTraceSession(
      'live-session',
      [{
        protocolVersion: 'mbse-agent-trace.v1',
        sessionId: 'live-session',
        sequence: 1,
        timestamp: '2026-07-13T00:00:01.000Z',
        phase: 'extraction',
        type: 'progress',
        rawKind: 'progress',
        message: '开始抽取',
        payload: { percent: 10 },
        percent: 10,
      }],
      '2026-07-13T00:00:01.000Z',
    );
    const next = appendAgentEventsToSessions(
      [historicalSession, liveSession],
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'live-session',
          sequence: 2,
          timestamp: '2026-07-13T00:00:02.000Z',
          phase: 'extraction',
          type: 'progress',
          rawKind: 'progress',
          message: '继续抽取',
          payload: { percent: 50 },
          percent: 50,
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'live-session',
          sequence: 3,
          timestamp: '2026-07-13T00:00:03.000Z',
          phase: 'extraction',
          type: 'sdk-event',
          rawKind: 'message_end',
          message: 'SDK 消息结束',
          payload: { type: 'message_end' },
        },
      ],
    );

    expect(next[0]).toBe(historicalSession);
    expect(next[1]?.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(next[1]?.events.map((event) => event.message)).toEqual(['开始抽取', '继续抽取', 'SDK 消息结束']);
  });

  it('实时事件乱序或重复时回退排序并保留完成语义', () => {
    const current = createTraceSession(
      'out-of-order-session',
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'out-of-order-session',
          sequence: 1,
          timestamp: '2026-07-13T00:00:01.000Z',
          phase: 'session',
          type: 'session-started',
          rawKind: 'session_start',
          message: '会话开始',
          payload: {},
          provider: 'initial-provider',
          model: 'initial-model',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'out-of-order-session',
          sequence: 3,
          timestamp: '2026-07-13T00:00:03.000Z',
          phase: 'extraction',
          type: 'progress',
          rawKind: 'progress',
          message: '旧的重复事件',
          payload: { percent: 30 },
          percent: 30,
        },
      ],
      '2026-07-13T00:00:03.000Z',
    );
    const next = appendAgentEventsToSessions(
      [current],
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'out-of-order-session',
          sequence: 3,
          timestamp: '2026-07-13T00:00:03.100Z',
          phase: 'extraction',
          type: 'progress',
          rawKind: 'progress',
          message: '新的重复事件',
          payload: { percent: 80 },
          percent: 80,
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'out-of-order-session',
          sequence: 2,
          timestamp: '2026-07-13T00:00:02.000Z',
          phase: 'validation',
          type: 'phase',
          rawKind: 'phase',
          message: '进入校验阶段',
          payload: { step: 'validate', status: 'started' },
          step: 'validate',
          phaseStatus: 'started',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'out-of-order-session',
          sequence: 4,
          timestamp: '2026-07-13T00:00:04.000Z',
          phase: 'session',
          type: 'session-finished',
          rawKind: 'session_end',
          message: '会话完成',
          payload: { status: 'success' },
          status: 'success',
          provider: 'final-provider',
          model: 'final-model',
          completedAt: '2026-07-13T00:00:04.000Z',
        },
      ],
    );

    expect(next[0]?.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(next[0]?.events[1]?.phase).toBe('validation');
    expect(next[0]?.events[2]?.message).toBe('新的重复事件');
    expect(next[0]?.provider).toBe('final-provider');
    expect(next[0]?.model).toBe('final-model');
    expect(next[0]?.completedAt).toBe('2026-07-13T00:00:04.000Z');
  });

});

describe('Agent trace 协议归一化', () => {
  it('保留 Error payload 的 cause 与自定义字段', () => {
    const trace = createTraceCollector({
      sessionId: 'protocol-error-session',
      provider: 'test-provider',
      model: 'test-model',
    });
    const rootCause = new Error('root cause');
    const error = new Error('outer error', { cause: rootCause }) as Error & { code?: string; details?: unknown };
    error.code = 'E_CUSTOM';
    error.details = { stage: 'protocol-test', retryable: false };

    trace.emit({
      type: 'sdk-event',
      phase: 'session',
      rawKind: 'custom_error',
      message: 'custom error payload',
      payload: error,
    });

    expect(trace.events).toHaveLength(1);
    type EncodedProperty = {
      key: { type: string; value: string };
      value?: unknown;
    };
    const errorPayload = trace.events[0]?.payload as {
      $mbseAgentTrace: { type: string; name: string; properties: EncodedProperty[] };
    };
    const propertyValue = (properties: EncodedProperty[], key: string) => (
      properties.find((entry) => entry.key.type === 'string' && entry.key.value === key)?.value
    );
    expect(errorPayload.$mbseAgentTrace).toMatchObject({ type: 'error', name: 'Error' });
    expect(propertyValue(errorPayload.$mbseAgentTrace.properties, 'message')).toBe('outer error');
    expect(propertyValue(errorPayload.$mbseAgentTrace.properties, 'code')).toBe('E_CUSTOM');
    expect(propertyValue(errorPayload.$mbseAgentTrace.properties, 'details')).toEqual({
      stage: 'protocol-test',
      retryable: false,
    });
    const cause = propertyValue(errorPayload.$mbseAgentTrace.properties, 'cause') as {
      $mbseAgentTrace: { type: string; properties: EncodedProperty[] };
    };
    expect(cause.$mbseAgentTrace.type).toBe('error');
    expect(propertyValue(cause.$mbseAgentTrace.properties, 'message')).toBe('root cause');
  });

  it('为不可 JSON 值保留无碰撞类型标记', () => {
    const trace = createTraceCollector({ sessionId: 'non-json-values-session' });
    const circular: { label: string; self?: unknown } = { label: 'cycle' };
    circular.self = circular;

    trace.emit({
      type: 'sdk-event',
      phase: 'session',
      rawKind: 'non_json_values',
      message: '保留不可 JSON 值。',
      payload: {
        realNull: null,
        undefinedValue: undefined,
        nan: Number.NaN,
        positiveInfinity: Number.POSITIVE_INFINITY,
        negativeInfinity: Number.NEGATIVE_INFINITY,
        negativeZero: -0,
        bigint: 1n,
        markerText: '[circular]',
        circular,
        reservedTagObject: { $mbseAgentTrace: { type: 'undefined' } },
        reservedUndefinedObject: { $mbseAgentTrace: undefined },
      },
    });

    const payload = trace.events[0]?.payload as Record<string, unknown>;
    expect(payload.realNull).toBeNull();
    expect(payload.undefinedValue).toEqual({ $mbseAgentTrace: { type: 'undefined' } });
    expect(payload.nan).toEqual({ $mbseAgentTrace: { type: 'number', value: 'NaN' } });
    expect(payload.positiveInfinity).toEqual({ $mbseAgentTrace: { type: 'number', value: 'Infinity' } });
    expect(payload.negativeInfinity).toEqual({ $mbseAgentTrace: { type: 'number', value: '-Infinity' } });
    expect(payload.negativeZero).toEqual({ $mbseAgentTrace: { type: 'number', value: '-0' } });
    expect(payload.bigint).toEqual({ $mbseAgentTrace: { type: 'bigint', value: '1' } });
    expect(payload.markerText).toBe('[circular]');
    expect(payload.circular).toEqual({
      label: 'cycle',
      self: { $mbseAgentTrace: { type: 'reference', path: '$.circular' } },
    });
    const reservedTagObject = payload.reservedTagObject as {
      $mbseAgentTrace: { type: string; constructor: string; properties: Array<{ key: unknown; value: unknown }> };
    };
    expect(reservedTagObject.$mbseAgentTrace).toMatchObject({
      type: 'object',
      constructor: 'Object',
      properties: [{
        key: { type: 'string', value: '$mbseAgentTrace' },
        value: { type: 'undefined' },
      }],
    });
    expect(payload.reservedTagObject).not.toEqual(payload.reservedUndefinedObject);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('保留 symbol、non-enumerable 与 __proto__ 自有字段', () => {
    const trace = createTraceCollector({ sessionId: 'own-properties-session' });
    const symbolKey = Symbol('trace-symbol');
    const value: Record<PropertyKey, unknown> = {};
    Object.defineProperty(value, 'hidden', { value: 'secret', enumerable: false, configurable: true });
    Object.defineProperty(value, '__proto__', { value: 'literal-prototype-field', enumerable: true, configurable: true });
    Object.defineProperty(value, symbolKey, { value: 'symbol-value', enumerable: true, configurable: true });

    trace.emit({
      type: 'sdk-event',
      phase: 'session',
      rawKind: 'own_properties',
      message: '保留全部自有字段。',
      payload: value,
    });

    const payload = trace.events[0]?.payload as {
      $mbseAgentTrace: {
        type: string;
        properties: Array<{ key: { type: string; value: string }; value: unknown }>;
      };
    };
    expect(payload.$mbseAgentTrace.type).toBe('object');
    expect(payload.$mbseAgentTrace.properties).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { type: 'string', value: 'hidden' }, value: 'secret' }),
      expect.objectContaining({ key: { type: 'string', value: '__proto__' }, value: 'literal-prototype-field' }),
      expect.objectContaining({ key: { type: 'symbol', value: 'Symbol(trace-symbol)' }, value: 'symbol-value' }),
    ]));
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('明确标记无法同步检查内部状态的值', () => {
    const trace = createTraceCollector({ sessionId: 'uninspectable-values-session' });
    const weakKey = {};
    trace.emit({
      type: 'sdk-event',
      phase: 'session',
      rawKind: 'uninspectable_values',
      message: '标记无法同步检查的内部状态。',
      payload: {
        weakMap: new WeakMap([[weakKey, { secret: true }]]),
        weakSet: new WeakSet([weakKey]),
        promise: Promise.resolve('settled-value'),
      },
    });

    const payload = trace.events[0]?.payload as Record<string, {
      $mbseAgentTrace: { type: string; uninspectable: boolean; reason: string };
    }>;
    expect(payload.weakMap?.$mbseAgentTrace).toMatchObject({ type: 'weak-map', uninspectable: true });
    expect(payload.weakSet?.$mbseAgentTrace).toMatchObject({ type: 'weak-set', uninspectable: true });
    expect(payload.promise?.$mbseAgentTrace).toMatchObject({ type: 'promise', uninspectable: true });
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('保留自定义原型并把 descriptor 读取失败编码为事件', () => {
    const trace = createTraceCollector({ sessionId: 'reflective-values-session' });
    const customPrototype = { inherited: true };
    const customPrototypeValue = Object.assign(Object.create(customPrototype), { x: 1 });
    const throwingDescriptorValue = new Proxy({ x: 1 }, {
      ownKeys: () => ['x'],
      getOwnPropertyDescriptor: () => {
        throw new Error('blocked descriptor');
      },
    });
    const throwingClassificationValue = new Proxy({}, {
      getPrototypeOf: () => {
        throw new Error('blocked prototype classification');
      },
    });

    trace.emit({
      type: 'sdk-event',
      phase: 'session',
      rawKind: 'reflective_values',
      message: '保留反射读取异常。',
      payload: { customPrototypeValue, throwingClassificationValue, throwingDescriptorValue },
    });

    const payload = trace.events[0]?.payload as Record<string, {
      $mbseAgentTrace: {
        type: string;
        prototype?: { kind: string; constructor: string | null };
        message?: string;
        path?: string;
        properties: Array<{
          descriptor: { kind: string };
          error?: { $mbseAgentTrace: { type: string; message: string } };
        }>;
      };
    }>;
    expect(payload.customPrototypeValue?.$mbseAgentTrace).toMatchObject({
      type: 'object',
      prototype: { kind: 'custom', constructor: 'Object' },
    });
    expect(payload.throwingClassificationValue?.$mbseAgentTrace).toMatchObject({
      type: 'inspection-error',
      message: 'blocked prototype classification',
      path: '$.throwingClassificationValue',
    });
    expect(payload.throwingDescriptorValue?.$mbseAgentTrace.properties[0]).toMatchObject({
      descriptor: { kind: 'uninspectable' },
      error: { $mbseAgentTrace: { type: 'property-inspection-error', message: 'blocked descriptor' } },
    });
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('Error name getter 抛错时仍发出可审计 payload', () => {
    const trace = createTraceCollector({ sessionId: 'throwing-error-name-session' });
    const error = Object.create(Error.prototype);
    Object.defineProperty(error, 'name', {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error('blocked error name');
      },
    });
    Object.defineProperty(error, 'message', {
      configurable: true,
      enumerable: true,
      value: 'original message',
    });

    trace.emit({
      type: 'sdk-event',
      phase: 'session',
      rawKind: 'throwing_error_name',
      message: '保留 Error name 读取异常。',
      payload: error,
    });

    const payload = trace.events[0]?.payload as {
      $mbseAgentTrace: {
        type: string;
        name: { $mbseAgentTrace: { type: string; message: string } };
      };
    };
    expect(payload.$mbseAgentTrace).toMatchObject({
      type: 'error',
      name: {
        $mbseAgentTrace: {
          type: 'property-inspection-error',
          message: 'blocked error name',
        },
      },
    });
  });

  it('sidecar 失败事件保留原始 Error 到 payload', () => {
    const emitted = {
      error: null as { message: string; options: { payload: Record<string, unknown>; code: string } } | null,
      finished: null as { status: string; payload: Record<string, unknown> } | null,
    };
    const trace = {
      events: [] as Array<{ type: string }>,
      emitError(message: string, options: { payload: Record<string, unknown>; code: string }) {
        emitted.error = { message, options };
      },
      emitSessionFinished(status: string, _completedAt: string, payload: Record<string, unknown>) {
        emitted.finished = { status, payload };
      },
    };
    const rootCause = new Error('nested cause');
    const error = new Error('failed turn', { cause: rootCause }) as Error & { code?: string };
    error.code = 'E_SIDECAR';

    emitSidecarFailure(trace, error, 'model-draft', 'model-draft-failed', {
      fallbackMessage: 'fallback',
      error: 'must-not-override',
      code: 'wrong-code',
    });

    expect(emitted.error?.message).toBe('failed turn');
    expect(emitted.error?.options.code).toBe('model-draft-failed');
    expect(emitted.error?.options.payload.fallbackMessage).toBe('fallback');
    expect(emitted.error?.options.payload.error).toBe(error);
    expect(emitted.finished).toEqual({
      status: 'error',
      payload: { fallbackMessage: 'fallback', error: 'must-not-override', code: 'model-draft-failed' },
    });
  });

  it('hostile thrown value 仍产生 error 与 session-finished 事件', () => {
    const trace = createTraceCollector({ sessionId: 'hostile-failure-session' });
    const hostileError = new Proxy({}, {
      get: () => {
        throw new Error('blocked string conversion');
      },
      getOwnPropertyDescriptor: () => {
        throw new Error('blocked message inspection');
      },
      getPrototypeOf: () => {
        throw new Error('blocked prototype inspection');
      },
    });

    emitSidecarFailure(trace, hostileError, 'model-draft', 'hostile-failure');

    expect(trace.events.map((event) => event.type)).toEqual(['error', 'session-finished']);
    expect(trace.events[0]).toMatchObject({
      type: 'error',
      code: 'hostile-failure',
      message: 'Inspection failed with an uninspectable thrown value.',
    });
    expect(trace.events[0]?.payload).toMatchObject({
      error: {
        $mbseAgentTrace: {
          type: 'inspection-error',
          message: 'blocked prototype inspection',
        },
      },
    });
  });

  it('直接覆盖 SDK producer 映射', () => {
    const trace = createTraceCollector({
      sessionId: 'sdk-forward-session',
      provider: 'test-provider',
      model: 'test-model',
    });

    const thinkingStart = {
      type: 'message_update',
      message: { content: [], role: 'assistant' },
      assistantMessageEvent: { type: 'thinking_start', contentIndex: 0, partial: { role: 'assistant', content: [] } },
    };
    const thinkingDelta = {
      type: 'message_update',
      message: { content: [], role: 'assistant' },
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '推理增量', partial: { role: 'assistant', content: [{ type: 'thinking', thinking: '推理增量' }] } },
    };
    const thinkingEnd = {
      type: 'message_update',
      message: { content: [], role: 'assistant' },
      assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: '推理完成', partial: { role: 'assistant', content: [{ type: 'thinking', thinking: '推理完成' }] } },
    };
    const textDelta = {
      type: 'message_update',
      message: { content: [], role: 'assistant' },
      assistantMessageEvent: { type: 'text_delta', delta: '文本片段', partial: { role: 'assistant', content: [{ type: 'text', text: '文本片段' }] } },
    };
    const toolcallDelta = {
      type: 'message_update',
      message: { content: [], role: 'assistant' },
      assistantMessageEvent: { type: 'toolcall_delta', delta: '{"path":"output/model.sysml"}', partial: { role: 'assistant', content: [{ type: 'toolCall', arguments: '{"path":"output/model.sysml"}' }] } },
    };
    const streamError = {
      type: 'message_update',
      message: { content: [], role: 'assistant' },
      assistantMessageEvent: { type: 'error', error: { errorMessage: 'stream failed' }, partial: { role: 'assistant', content: [] } },
    };
    const toolStart = {
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'write',
      args: { path: 'output/model.sysml' },
      intent: '写入模型工件',
    };
    const toolUpdate = {
      type: 'tool_execution_update',
      toolCallId: 'tool-1',
      toolName: 'write',
      args: { path: 'output/model.sysml' },
      partialResult: { bytes: 128 },
    };
    const toolEnd = {
      type: 'tool_execution_end',
      toolCallId: 'tool-1',
      toolName: 'write',
      args: { path: 'output/model.sysml' },
      result: { ok: true, bytes: 128 },
      isError: false,
    };

    forwardSdkSessionEvent(trace, thinkingStart, 'model-draft');
    forwardSdkSessionEvent(trace, thinkingDelta, 'model-draft');
    forwardSdkSessionEvent(trace, thinkingEnd, 'model-draft');
    forwardSdkSessionEvent(trace, textDelta, 'model-draft');
    forwardSdkSessionEvent(trace, toolcallDelta, 'model-draft');
    forwardSdkSessionEvent(trace, streamError, 'model-draft');
    forwardSdkSessionEvent(trace, toolStart, 'model-draft');
    forwardSdkSessionEvent(trace, toolUpdate, 'model-draft');
    forwardSdkSessionEvent(trace, toolEnd, 'model-draft');

    expect(trace.events.map((event) => event.type)).toEqual([
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
      'output-delta',
      'output-delta',
      'error',
      'tool-call-start',
      'tool-call-update',
      'tool-call-end',
    ]);
    expect(trace.events[0]).toMatchObject({
      type: 'reasoning-start',
      payload: thinkingStart,
    });
    expect(trace.events[0]?.payload).toEqual(thinkingStart);
    expect(trace.events[1]).toMatchObject({
      type: 'reasoning-delta',
      text: '推理增量',
      payload: thinkingDelta,
    });
    expect(trace.events[1]?.payload).toEqual(thinkingDelta);
    expect(trace.events[2]).toMatchObject({
      type: 'reasoning-end',
      text: '推理完成',
      payload: thinkingEnd,
    });
    expect(trace.events[2]?.payload).toEqual(thinkingEnd);
    expect(trace.events[3]).toMatchObject({
      type: 'output-delta',
      channel: 'assistant-text',
      text: '文本片段',
      payload: textDelta,
    });
    expect(trace.events[3]?.payload).toEqual(textDelta);
    expect(trace.events[4]).toMatchObject({
      type: 'output-delta',
      channel: 'assistant-toolcall',
      text: '{"path":"output/model.sysml"}',
      payload: toolcallDelta,
    });
    expect(trace.events[4]?.payload).toEqual(toolcallDelta);
    expect(trace.events[5]).toMatchObject({
      type: 'error',
      code: 'assistant-stream-error',
      payload: streamError,
    });
    expect(trace.events[5]?.payload).toEqual(streamError);
    expect(trace.events[6]).toMatchObject({
      type: 'tool-call-start',
      toolName: 'write',
      argsSummary: '{"path":"output/model.sysml"}',
      payload: toolStart,
    });
    expect(trace.events[6]?.payload).toEqual(toolStart);
    expect(trace.events[7]).toMatchObject({
      type: 'tool-call-update',
      partialSummary: '{"bytes":128}',
      payload: toolUpdate,
    });
    expect(trace.events[7]?.payload).toEqual(toolUpdate);
    expect(trace.events[8]).toMatchObject({
      type: 'tool-call-end',
      resultSummary: '{"ok":true,"bytes":128}',
      payload: toolEnd,
    });
    expect(trace.events[8]?.payload).toEqual(toolEnd);
  });

  it('工具事件摘要忽略未定义输入并提取可读结果文本', () => {
    const trace = createTraceCollector({ sessionId: 'semantic-tool-summary-session' });
    const toolStart = {
      type: 'tool_execution_start',
      toolCallId: 'search-1',
      toolName: 'web_search',
      args: undefined,
    };
    const toolEnd = {
      type: 'tool_execution_end',
      toolCallId: 'search-1',
      toolName: 'web_search',
      result: {
        content: [{
          type: 'text',
          text: '**检索完成**\n\n- [官方资料](https://example.com/source)',
        }],
        details: { resultCount: 1 },
      },
      isError: false,
    };

    forwardSdkSessionEvent(trace, toolStart, 'extraction');
    forwardSdkSessionEvent(trace, toolEnd, 'extraction');

    expect(trace.events[0]).toMatchObject({
      type: 'tool-call-start',
      toolName: 'web_search',
      argsSummary: undefined,
    });
    expect(trace.events[1]).toMatchObject({
      type: 'tool-call-end',
      resultSummary: '**检索完成**\n\n- [官方资料](https://example.com/source)',
    });
    expect(trace.events[1]?.payload).toMatchObject({
      result: {
        details: { resultCount: 1 },
      },
    });
  });

  it('SDK 事件分类读取失败时仍发出可审计 sdk-event', () => {
    const trace = createTraceCollector({ sessionId: 'hostile-sdk-event-session' });
    const hostileEvent = new Proxy({}, {
      get(_target, key) {
        if (key === 'type') {
          throw new Error('blocked SDK event type');
        }
        return undefined;
      },
    });

    forwardSdkSessionEvent(trace, hostileEvent, 'model-draft');

    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]).toMatchObject({
      type: 'sdk-event',
      rawKind: 'sdk_event_inspection_error',
      phase: 'model-draft',
    });
    expect(trace.events[0]?.payload).toMatchObject({
      event: {},
      inspection: {
        type: 'inspection-error',
        message: 'blocked SDK event type',
        path: '$.event.type',
      },
    });
  });

  it('工具结束归一化结果携带安全 yield details 投影', () => {
    const trace = createTraceCollector({ sessionId: 'yield-projection-session' });
    const details = {
      status: 'success',
      schemaOverridden: false,
      data: { projectId: 'tianwen-2' },
    };

    const forwarded = forwardSdkSessionEvent(trace, {
      type: 'tool_execution_end',
      toolCallId: 'yield-call',
      toolName: 'yield',
      isError: false,
      result: { details },
    }, 'model-draft');

    expect(forwarded).toEqual({
      kind: 'tool-call-end',
      toolName: 'yield',
      isError: false,
      yieldDetails: details,
    });
    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]).toMatchObject({
      type: 'tool-call-end',
      toolName: 'yield',
      isError: false,
    });
  });

  it('trace-only 持久化状态在首页也显示专用轨迹面板', async () => {
    enableTauriRuntime();
    const persistedTraceOnlyProject = {
      projectRoot: 'local/project-root',
      savedAt: '2026-07-13T00:00:00.000Z',
      manifestPath: 'sample-projects/tianwen-2/project.json',
      manifest: { id: 'tianwen-2', name: '天问二号探测器样例项目', caseName: '天问二号探测器', workspaceBoundary: '独立工作区' },
      sourceMaterials: [],
      modelArtifacts: [],
      confirmedData: null,
      generatedArtifacts: null,
      sidecarDraft: null,
      agentTraceSessions: [createLegacyAgentModelingSession({
        sessionId: 'persisted-trace-only-session',
        provider: 'test-provider',
        model: 'test-model',
        completedAt: '2026-07-13T00:00:00.000Z',
        events: [{
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'persisted-trace-only-session',
          sequence: 1,
          timestamp: '2026-07-13T00:00:00.000Z',
          phase: 'session',
          type: 'reasoning-start',
          rawKind: 'thinking_start',
          message: '模型进入 reasoning 阶段。',
          payload: null,
          contentIndex: 0,
        }],
      })],
      lastExportedBundle: null,
      files: [],
    };

    tauriInvokeMock.mockImplementation(async (command: string) => {
      if (command === 'agent_sidecar_status') return { state: 'stopped', pid: null, endpoint: null };
      if (command === 'load_workbench_project') return persistedTraceOnlyProject;
      if (command === 'save_workbench_project') return persistedTraceOnlyProject;
      if (command === 'export_workbench_project') return null;
      throw new Error(`未预期的 Tauri 命令：${command}`);
    });

    render(React.createElement(App));
    await waitFor(() => {
      expect(screen.getByLabelText(/项目工作区首页/)).toBeVisible();
    });
    expect(screen.getByText('已保存的 Agent 执行轨迹')).toBeVisible();
    fireEvent.click(screen.getByText('已保存的 Agent 执行轨迹'));
    openTracePhase('会话状态');
    expect(screen.getByText('思考过程')).toBeVisible();
    openTraceDebug();
    fireEvent.click(screen.getByText('原始 payload'));
    const visiblePayload = Array.from(document.querySelectorAll('.agent-trace-payload'))
      .find((node) => !node.closest('.ant-collapse-content-hidden'));
    expect(visiblePayload).toBeVisible();
    expect(visiblePayload).toHaveTextContent('null');
  });

  it('加载缺失 sidecarDraft.sourceSet 的旧状态时不会在工作区白屏', async () => {
    enableTauriRuntime();
    const draft = await createValidAgentDraft('legacy-app-load-session');
    const persistedState = createWorkbenchProjectState(loadBundledTianwen2Project(), { sidecarDraft: draft });
    const incompleteDraft = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;
    delete incompleteDraft.sourceSet;
    const legacyLoadedState = {
      ...persistedState,
      manifest: {
        ...persistedState.manifest,
        name: '旧状态重载回归项目',
      },
      sidecarDraft: incompleteDraft as unknown as ModelGenerationResult,
    };

    tauriInvokeMock.mockImplementation(async (command: string) => {
      if (command === 'agent_sidecar_status') return { state: 'stopped', pid: null, endpoint: null };
      if (command === 'load_workbench_project') return legacyLoadedState;
      if (command === 'save_workbench_project') return legacyLoadedState;
      if (command === 'export_workbench_project') return null;
      throw new Error(`未预期的 Tauri 命令：${command}`);
    });

    render(React.createElement(App));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '旧状态重载回归项目' })).toBeVisible();
    });
    expect(screen.queryByText('模型浏览器')).not.toBeInTheDocument();
    expect(screen.getByText('项目检查器')).toBeVisible();
    expect(screen.getByText('资源预览')).toBeVisible();
    expect(screen.getByLabelText('项目工作区首页')).toBeVisible();
  });

  it('null payload 仍保留查看入口', () => {
    const session = createTraceSession(
      'trace-null-payload-session',
      [{
        protocolVersion: 'mbse-agent-trace.v1',
        sessionId: 'trace-null-payload-session',
        sequence: 1,
        timestamp: '2026-07-13T00:00:00.000Z',
        phase: 'session',
        type: 'sdk-event',
        rawKind: 'noop',
        message: '空 payload 事件。',
        payload: null,
      }],
      '2026-07-13T00:00:00.100Z',
    );

    render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false }));
    openTracePhase('会话状态');
    openTraceDebug();
    fireEvent.click(screen.getByText('原始 payload'));
    const visiblePayload = Array.from(document.querySelectorAll('.agent-trace-payload'))
      .find((node) => !node.closest('.ant-collapse-content-hidden'));
    expect(visiblePayload).toBeVisible();
    expect(visiblePayload).toHaveTextContent('null');
  });

  it('空对象与空数组 payload 仍保留查看入口', () => {
    const session = createTraceSession(
      'trace-empty-payload-session',
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-empty-payload-session',
          sequence: 1,
          timestamp: '2026-07-13T00:00:00.000Z',
          phase: 'session',
          type: 'sdk-event',
          rawKind: 'empty-object',
          message: '空对象 payload 事件。',
          payload: {},
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-empty-payload-session',
          sequence: 2,
          timestamp: '2026-07-13T00:00:00.100Z',
          phase: 'session',
          type: 'sdk-event',
          rawKind: 'empty-array',
          message: '空数组 payload 事件。',
          payload: [],
        },
      ],
      '2026-07-13T00:00:00.200Z',
    );

    render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false }));
    openTracePhase('会话状态');
    openTraceDebug();
    const payloadButtons = screen.getAllByText('原始 payload');
    fireEvent.click(payloadButtons[0]!);
    const objectPayload = Array.from(document.querySelectorAll('.agent-trace-payload'))
      .find((node) => !node.closest('.ant-collapse-content-hidden'));
    expect(objectPayload).toBeVisible();
    expect(objectPayload).toHaveTextContent('{}');
    fireEvent.click(payloadButtons[1]!);
    const arrayPayload = Array.from(document.querySelectorAll('.agent-trace-payload'))
      .find((node) => !node.closest('.ant-collapse-content-hidden') && node.textContent?.includes('[]'));
    expect(arrayPayload).toBeVisible();
  });
});

describe('Agent trace 流式展示', () => {
  it('将增量事件聚合为消息与工具块，并使用明确的内容内边距', () => {
    const session = createTraceSession(
      'trace-semantic-session',
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-semantic-session',
          sequence: 1,
          timestamp: '2026-07-13T00:00:00.000Z',
          phase: 'extraction',
          type: 'reasoning-start',
          rawKind: 'thinking_start',
          message: '模型进入 reasoning 阶段。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } },
          contentIndex: 0,
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-semantic-session',
          sequence: 2,
          timestamp: '2026-07-13T00:00:00.100Z',
          phase: 'extraction',
          type: 'reasoning-delta',
          rawKind: 'thinking_delta',
          message: '模型正在进行 reasoning。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '先分析' } },
          contentIndex: 0,
          text: '先分析',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-semantic-session',
          sequence: 3,
          timestamp: '2026-07-13T00:00:00.200Z',
          phase: 'extraction',
          type: 'reasoning-delta',
          rawKind: 'thinking_delta',
          message: '模型正在进行 reasoning。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '需求' } },
          contentIndex: 0,
          text: '需求',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-semantic-session',
          sequence: 4,
          timestamp: '2026-07-13T00:00:00.300Z',
          phase: 'extraction',
          type: 'reasoning-end',
          rawKind: 'thinking_end',
          message: '模型完成 reasoning 阶段。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: '先分析需求' } },
          contentIndex: 0,
          text: '先分析需求',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-semantic-session',
          sequence: 5,
          timestamp: '2026-07-13T00:00:00.400Z',
          phase: 'extraction',
          type: 'output-delta',
          rawKind: 'text_delta',
          message: '模型返回文本片段。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: '候选需求' } },
          channel: 'assistant-text',
          text: '候选需求',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-semantic-session',
          sequence: 6,
          timestamp: '2026-07-13T00:00:00.500Z',
          phase: 'extraction',
          type: 'output-delta',
          rawKind: 'text_delta',
          message: '模型返回文本片段。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: '生成完成' } },
          channel: 'assistant-text',
          text: '生成完成',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-semantic-session',
          sequence: 7,
          timestamp: '2026-07-13T00:00:00.600Z',
          phase: 'extraction',
          type: 'tool-call-start',
          rawKind: 'tool_execution_start',
          message: '开始写入候选需求。',
          payload: { type: 'tool_execution_start', toolCallId: 'write-candidates', toolName: 'write', args: { path: 'requirements.json' } },
          toolCallId: 'write-candidates',
          toolName: 'write',
          argsSummary: '{"path":"requirements.json"}',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-semantic-session',
          sequence: 8,
          timestamp: '2026-07-13T00:00:00.700Z',
          phase: 'extraction',
          type: 'tool-call-update',
          rawKind: 'tool_execution_update',
          message: '正在写入候选需求。',
          payload: { type: 'tool_execution_update', toolCallId: 'write-candidates', toolName: 'write', partialResult: { bytes: 128 } },
          toolCallId: 'write-candidates',
          toolName: 'write',
          partialSummary: '{"bytes":128}',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-semantic-session',
          sequence: 9,
          timestamp: '2026-07-13T00:00:00.800Z',
          phase: 'extraction',
          type: 'tool-call-end',
          rawKind: 'tool_execution_end',
          message: '候选需求写入完成。',
          payload: { type: 'tool_execution_end', toolCallId: 'write-candidates', toolName: 'write', isError: false },
          toolCallId: 'write-candidates',
          toolName: 'write',
          resultSummary: '{"ok":true}',
          isError: false,
        },
      ],
      '2026-07-13T00:00:00.900Z',
    );

    const { container, rerender } = render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false }));
    openTracePhase('需求抽取');

    expect(within(screen.getByTestId('trace-reasoning-0')).getByText('先分析需求')).toBeVisible();
    expect(screen.getAllByTestId('trace-reasoning-0')).toHaveLength(1);
    expect(within(screen.getByTestId('trace-assistant-1')).getByText('候选需求生成完成')).toBeVisible();
    expect(screen.getAllByTestId('tool-call-write-candidates')).toHaveLength(1);
    expect(screen.queryByText('reasoning-delta')).not.toBeInTheDocument();
    expect(container.querySelector('.agent-trace-event-row')).not.toBeInTheDocument();

    const cardBody = container.querySelector('.agent-trace-card > .ant-card-body');
    const sessionElement = container.querySelector('.agent-trace-session');
    expect(cardBody).not.toBeNull();
    expect(sessionElement).not.toBeNull();
    expect(getComputedStyle(cardBody!).paddingTop).toBe('16px');
    expect(getComputedStyle(cardBody!).paddingLeft).toBe('20px');
    expect(getComputedStyle(sessionElement!).gap).toBe('16px');

    rerender(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false, embedded: true }));
    const embeddedPanel = container.querySelector('.agent-trace-embedded');
    expect(embeddedPanel).not.toBeNull();
    expect(getComputedStyle(embeddedPanel!).paddingTop).toBe('16px');
    expect(getComputedStyle(embeddedPanel!).paddingLeft).toBe('20px');
  });

  it('将 reasoning、Agent 输出与工具内容渲染为安全的 Markdown DOM', () => {
    const session = createTraceSession(
      'trace-markdown-session',
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-markdown-session',
          sequence: 1,
          timestamp: '2026-07-13T00:00:00.000Z',
          phase: 'extraction',
          type: 'reasoning-end',
          rawKind: 'thinking_end',
          message: '分析完成。',
          payload: {},
          contentIndex: 0,
          text: '## 建模计划\n\n**优先识别任务边界**\n\n- 分析需求\n- 建立追溯',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-markdown-session',
          sequence: 2,
          timestamp: '2026-07-13T00:00:00.100Z',
          phase: 'extraction',
          type: 'output-delta',
          rawKind: 'text_delta',
          message: '生成响应。',
          payload: {},
          channel: 'assistant-text',
          text: '### 分析结果\n\n使用 `SysML v2` 表达模型。\n\n```sysml\npackage MissionModel;\n```',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-markdown-session',
          sequence: 3,
          timestamp: '2026-07-13T00:00:00.200Z',
          phase: 'extraction',
          type: 'output-delta',
          rawKind: 'toolcall_delta',
          message: '模型组织工具调用。',
          payload: {
            message: {
              content: [
                { type: 'text', text: '' },
                {
                  type: 'toolCall',
                  id: 'markdown-tool',
                  name: 'web_search',
                  arguments: { query: '天问二号 官方任务资料' },
                },
              ],
            },
            assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1 },
          },
          channel: 'assistant-toolcall',
          text: '{"query":"天问二号 官方任务资料"}',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-markdown-session',
          sequence: 4,
          timestamp: '2026-07-13T00:00:00.300Z',
          phase: 'extraction',
          type: 'tool-call-start',
          rawKind: 'tool_execution_start',
          message: '开始检索资料。',
          payload: { args: { $mbseAgentTrace: { type: 'undefined' } } },
          toolCallId: 'markdown-tool',
          toolName: 'web_search',
          argsSummary: '{"$mbseAgentTrace":{"type":"undefined"}}',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-markdown-session',
          sequence: 5,
          timestamp: '2026-07-13T00:00:00.400Z',
          phase: 'extraction',
          type: 'tool-call-end',
          rawKind: 'tool_execution_end',
          message: '资料检索完成。',
          payload: {
            result: {
              content: [{
                type: 'text',
                text: '#### 检索结果\n\n- [中国科学院任务资料](https://example.com/tianwen-2)',
              }],
            },
          },
          toolCallId: 'markdown-tool',
          toolName: 'web_search',
          resultSummary: '{"content":[{"type":"text","text":"#### 检索结果\\n\\n- [中国科学院任务资料](https://example.com/tianwen-2)"}]}',
          isError: false,
        },
      ],
      '2026-07-13T00:00:00.400Z',
    );

    render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false }));
    openTracePhase('需求抽取');

    const reasoning = screen.getByTestId('trace-reasoning-0');
    expect(within(reasoning).getByRole('heading', { level: 2, name: '建模计划' })).toBeVisible();
    expect(within(reasoning).getByText('优先识别任务边界').tagName).toBe('STRONG');
    expect(within(reasoning).getAllByRole('listitem')).toHaveLength(2);

    const assistant = screen.getByTestId('trace-assistant-2');
    expect(within(assistant).getByRole('heading', { level: 3, name: '分析结果' })).toBeVisible();
    expect(within(assistant).getByText('SysML v2').tagName).toBe('CODE');
    expect(assistant.querySelector('pre code')).toHaveTextContent('package MissionModel;');

    const tool = screen.getByTestId('tool-call-markdown-tool');
    expect(within(tool).getByText('联网检索')).toBeVisible();
    expect(within(tool).getByText('查询词')).toBeVisible();
    expect(within(tool).getByText('天问二号 官方任务资料')).toBeVisible();
    expect(within(tool).getByRole('heading', { level: 4, name: '检索结果' })).toBeVisible();
    expect(within(tool).getByRole('link', { name: '中国科学院任务资料' })).toHaveAttribute('href', 'https://example.com/tianwen-2');
    expect(tool.querySelector('pre')).not.toBeInTheDocument();
    expect(tool).not.toHaveTextContent('$mbseAgentTrace');
    expect(tool).not.toHaveTextContent('"content"');
    expect(reasoning).not.toHaveTextContent('**优先识别任务边界**');
  });

  it('write 工具显示目标、语言、行数与可读内容预览', () => {
    const source = `${'part def Spacecraft {}\n'.repeat(220)}SYSML_CONTENT_END`;
    const session = createTraceSession(
      'trace-large-tool-input-session',
      [{
        protocolVersion: 'mbse-agent-trace.v1',
        sessionId: 'trace-large-tool-input-session',
        sequence: 1,
        timestamp: '2026-07-13T00:00:00.000Z',
        phase: 'model-draft',
        type: 'tool-call-start',
        rawKind: 'tool_execution_start',
        message: '开始写入模型。',
        payload: {},
        toolCallId: 'write-large-model',
        toolName: 'write',
        argsSummary: JSON.stringify({ path: 'model.sysml', content: source }),
      }],
      '2026-07-13T00:00:00.100Z',
    );

    render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false }));
    openTracePhase('模型生成');

    const tool = screen.getByTestId('tool-call-write-large-model');
    expect(within(tool).getByText('文件')).toBeVisible();
    expect(within(tool).getByText('model.sysml')).toBeVisible();
    expect(within(tool).getByText('语言')).toBeVisible();
    expect(within(tool).getAllByText('SysML').length).toBeGreaterThan(0);
    expect(within(tool).getByText('内容行数')).toBeVisible();
    expect(within(tool).getAllByText(`${source.split(/\r?\n/).length} 行`).length).toBeGreaterThan(0);
    expect(tool).toHaveTextContent('写入内容预览');
    expect(tool).toHaveTextContent('part def Spacecraft {}');
    expect(within(tool).getByText('预览前 4000 个字符')).toBeVisible();
    expect(within(tool).queryByText(/SYSML_CONTENT_END/)).not.toBeInTheDocument();
    fireEvent.click(within(tool).getByText(`查看完整内容（${source.split(/\r?\n/).length} 行）`));
    expect(within(tool).getByText(/SYSML_CONTENT_END/)).toBeVisible();
  });

  it('read、grep 与 glob 工具按 OMP 字段展示参数和结果', () => {
    const sessionId = 'trace-specialized-tools-session';
    const base = {
      protocolVersion: 'mbse-agent-trace.v1' as const,
      sessionId,
      timestamp: '2026-07-13T00:00:00.000Z',
      phase: 'model-draft' as const,
    };
    const session = createTraceSession(
      sessionId,
      [
        {
          ...base,
          sequence: 1,
          type: 'tool-call-start',
          rawKind: 'tool_execution_start',
          message: '开始读取文件。',
          payload: { args: { path: 'src/model.sysml', selector: '10-20', offset: 10, limit: 11 } },
          toolCallId: 'read-specialized',
          toolName: 'read',
          argsSummary: '{"path":"src/model.sysml","selector":"10-20","offset":10,"limit":11}',
        },
        {
          ...base,
          sequence: 2,
          type: 'tool-call-end',
          rawKind: 'tool_execution_end',
          message: '文件读取完成。',
          payload: { result: { content: [{ type: 'text', text: 'part def Spacecraft {\n  attribute mass;\n}' }] } },
          toolCallId: 'read-specialized',
          toolName: 'read',
          resultSummary: 'part def Spacecraft {\n  attribute mass;\n}',
          isError: false,
        },
        {
          ...base,
          sequence: 3,
          type: 'tool-call-start',
          rawKind: 'tool_execution_start',
          message: '开始搜索内容。',
          payload: { args: { pattern: 'requirement def', path: 'src', case: true, gitignore: true, skip: 2 } },
          toolCallId: 'grep-specialized',
          toolName: 'grep',
          argsSummary: '{"pattern":"requirement def","path":"src","case":true,"gitignore":true,"skip":2}',
        },
        {
          ...base,
          sequence: 4,
          type: 'tool-call-end',
          rawKind: 'tool_execution_end',
          message: '内容搜索完成。',
          payload: { result: { content: [{ type: 'text', text: 'src/requirements.sysml:12:requirement def MissionRequirement' }] } },
          toolCallId: 'grep-specialized',
          toolName: 'grep',
          resultSummary: 'src/requirements.sysml:12:requirement def MissionRequirement',
          isError: false,
        },
        {
          ...base,
          sequence: 5,
          type: 'tool-call-start',
          rawKind: 'tool_execution_start',
          message: '开始查找文件。',
          payload: { args: { path: 'src/**/*.sysml', hidden: false, gitignore: true, limit: 20 } },
          toolCallId: 'glob-specialized',
          toolName: 'glob',
          argsSummary: '{"path":"src/**/*.sysml","hidden":false,"gitignore":true,"limit":20}',
        },
        {
          ...base,
          sequence: 6,
          type: 'tool-call-end',
          rawKind: 'tool_execution_end',
          message: '文件查找完成。',
          payload: { result: { content: [{ type: 'text', text: 'src/model.sysml\nsrc/requirements.sysml' }] } },
          toolCallId: 'glob-specialized',
          toolName: 'glob',
          resultSummary: 'src/model.sysml\nsrc/requirements.sysml',
          isError: false,
        },
      ],
      '2026-07-13T00:00:01.000Z',
    );

    render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false }));
    openTracePhase('模型生成');

    const readTool = screen.getByTestId('tool-call-read-specialized');
    expect(within(readTool).getByText('文件')).toBeVisible();
    expect(within(readTool).getByText('src/model.sysml')).toBeVisible();
    expect(within(readTool).getByText('选择器')).toBeVisible();
    expect(within(readTool).getByText('10-20')).toBeVisible();
    expect(within(readTool).getByText('起始位置')).toBeVisible();
    expect(within(readTool).getByText('10')).toBeVisible();
    expect(readTool).toHaveTextContent('attribute mass');

    const grepTool = screen.getByTestId('tool-call-grep-specialized');
    expect(within(grepTool).getByText('搜索模式')).toBeVisible();
    expect(within(grepTool).getByText('requirement def')).toBeVisible();
    expect(within(grepTool).getByText('搜索路径')).toBeVisible();
    expect(within(grepTool).getByText('src')).toBeVisible();
    expect(within(grepTool).getByText('区分大小写')).toBeVisible();
    expect(within(grepTool).getAllByText('是').length).toBeGreaterThan(0);
    expect(grepTool).toHaveTextContent('requirements.sysml:12');

    const globTool = screen.getByTestId('tool-call-glob-specialized');
    expect(within(globTool).getByText('Glob 模式')).toBeVisible();
    expect(within(globTool).getByText('src/**/*.sysml')).toBeVisible();
    expect(within(globTool).getByText('包含隐藏文件')).toBeVisible();
    expect(within(globTool).getAllByText('否').length).toBeGreaterThan(0);
    expect(within(globTool).getByText('数量上限')).toBeVisible();
    expect(within(globTool).getByText('20')).toBeVisible();
    expect(globTool).toHaveTextContent('src/model.sysml');
  });

  it('在运行中聚合 reasoning 与输出并按需展示调试 payload', () => {
    const session = createTraceSession(
      'trace-live-session',
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-live-session',
          sequence: 1,
          timestamp: '2026-07-13T00:00:00.000Z',
          phase: 'extraction',
          type: 'reasoning-start',
          rawKind: 'thinking_start',
          message: '模型进入 reasoning 阶段。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } },
          contentIndex: 0,
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-live-session',
          sequence: 2,
          timestamp: '2026-07-13T00:00:00.100Z',
          phase: 'extraction',
          type: 'reasoning-delta',
          rawKind: 'thinking_delta',
          message: '模型正在进行 reasoning。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: longReasoningDelta }, rawPayloadTail: longReasoningTail },
          contentIndex: 0,
          text: '先分析需求',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-live-session',
          sequence: 3,
          timestamp: '2026-07-13T00:00:00.200Z',
          phase: 'extraction',
          type: 'output-delta',
          rawKind: 'text_delta',
          message: '模型返回文本片段。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '片段一' } },
          channel: 'assistant-text',
          text: '片段一',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-live-session',
          sequence: 4,
          timestamp: '2026-07-13T00:00:00.300Z',
          phase: 'extraction',
          type: 'output-delta',
          rawKind: 'text_delta',
          message: '模型返回文本片段。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '片段二' } },
          channel: 'assistant-text',
          text: '片段二',
        },
      ],
      '2026-07-13T00:00:00.400Z',
    );

    const { container } = render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: true }));
    expect(screen.getByText(/流式进行中/)).toBeVisible();
    expect(screen.getByText('需求抽取')).toBeVisible();
    expect(screen.getByText('先分析需求')).toBeVisible();
    expect(screen.getByText('片段一片段二')).toBeVisible();
    expect(container.querySelector('.agent-trace-event-row')).not.toBeInTheDocument();

    openTraceDebug();
    expect(screen.getByText(/2026-07-13T00:00:00.100Z/)).toBeVisible();
    expect(screen.getByText('reasoning-delta')).toBeVisible();
    fireEvent.click(screen.getAllByText('原始 payload')[1]!);
    expect(screen.getByText(/TRACE_TAIL_1234567890_END/)).toBeInTheDocument();
  });

  it('折叠的原始 payload 不在实时刷新时重复序列化', () => {
    let serializationCount = 0;
    const payload = {
      toJSON() {
        serializationCount += 1;
        return { value: '仅展开后序列化' };
      },
    } as unknown as AgentSidecarEvent['payload'];
    const session = createTraceSession(
      'lazy-payload-session',
      [{
        protocolVersion: 'mbse-agent-trace.v1',
        sessionId: 'lazy-payload-session',
        sequence: 1,
        timestamp: '2026-07-13T00:00:00.000Z',
        phase: 'extraction',
        type: 'progress',
        rawKind: 'progress',
        message: '等待用户展开 payload',
        payload,
        percent: 10,
      }],
      '2026-07-13T00:00:01.000Z',
    );

    render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: true }));
    expect(serializationCount).toBe(0);
    openTraceDebug();
    expect(serializationCount).toBe(0);
    fireEvent.click(screen.getByText('原始 payload'));
    expect(serializationCount).toBe(1);
    expect(screen.getByText(/仅展开后序列化/)).toBeVisible();
  });

  it('高频实时事件按固定窗口批量提交且交互保持可响应', async () => {
    let eventHandler: TauriEventHandler | null = null;
    let renderCount = 0;
    tauriListenMock.mockImplementation(async (_eventName: string, nextHandler: TauriEventHandler) => {
      eventHandler = nextHandler;
      return () => {
        eventHandler = null;
      };
    });

    function TraceStressHarness() {
      renderCount += 1;
      const { sessions, beginLiveEventCapture, endLiveEventCapture } = useAgentTraceSessions(true);
      const [responseCount, setResponseCount] = React.useState(0);
      React.useEffect(() => {
        beginLiveEventCapture();
        return endLiveEventCapture;
      }, [beginLiveEventCapture, endLiveEventCapture]);
      const eventCount = sessions.reduce((total, session) => total + session.events.length, 0);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('output', { 'data-testid': 'stress-event-count' }, eventCount),
        React.createElement(
          'button',
          { type: 'button', onClick: () => setResponseCount((current) => current + 1) },
          `响应测试 ${responseCount}`,
        ),
      );
    }

    render(React.createElement(TraceStressHarness));
    await waitFor(() => {
      expect(eventHandler).not.toBeNull();
    });

    vi.useFakeTimers();
    try {
      for (let batch = 0; batch < 20; batch += 1) {
        act(() => {
          for (let index = 0; index < 25; index += 1) {
            const sequence = batch * 25 + index + 1;
            eventHandler?.({
              payload: {
                protocolVersion: 'mbse-agent-trace.v1',
                sessionId: 'stress-session',
                sequence,
                timestamp: new Date(1783965000000 + sequence).toISOString(),
                phase: 'extraction',
                type: 'sdk-event',
                rawKind: 'message_delta',
                message: `SDK 事件 ${sequence}`,
                payload: { sequence, text: '高频事件负载' },
              },
            });
          }
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10);
        });
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });

      expect(screen.getByTestId('stress-event-count')).toHaveTextContent('500');
      expect(renderCount).toBeLessThanOrEqual(6);
      fireEvent.click(screen.getByRole('button', { name: '响应测试 0' }));
      expect(screen.getByRole('button', { name: '响应测试 1' })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('按 toolCallId 折叠工具生命周期并显式标记失败', () => {
    const session = createTraceSession(
      'trace-failed-tool-session',
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-failed-tool-session',
          sequence: 1,
          timestamp: '2026-07-13T00:00:00.000Z',
          phase: 'model-draft',
          type: 'tool-call-start',
          rawKind: 'tool_execution_start',
          message: '开始写入模型文件。',
          payload: { type: 'tool_execution_start', toolCallId: 'write-model', toolName: 'write', args: { path: 'output/model.sysml' } },
          toolCallId: 'write-model',
          toolName: 'write',
          argsSummary: '{"path":"output/model.sysml"}',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-failed-tool-session',
          sequence: 2,
          timestamp: '2026-07-13T00:00:00.100Z',
          phase: 'model-draft',
          type: 'tool-call-update',
          rawKind: 'tool_execution_update',
          message: '正在写入模型文件。',
          payload: { type: 'tool_execution_update', toolCallId: 'write-model', toolName: 'write', partialResult: { bytes: 128 } },
          toolCallId: 'write-model',
          toolName: 'write',
          partialSummary: '{"bytes":128}',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-failed-tool-session',
          sequence: 3,
          timestamp: '2026-07-13T00:00:00.200Z',
          phase: 'model-draft',
          type: 'tool-call-end',
          rawKind: 'tool_execution_end',
          message: '模型文件写入失败。',
          payload: { type: 'tool_execution_end', toolCallId: 'write-model', toolName: 'write', isError: true, result: { code: 'EACCES' } },
          toolCallId: 'write-model',
          toolName: 'write',
          resultSummary: '{"code":"EACCES"}',
          isError: true,
        },
      ],
      '2026-07-13T00:00:00.300Z',
    );

    render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false }));
    openTracePhase('模型生成');

    const toolCall = screen.getByTestId('tool-call-write-model');
    expect(within(toolCall).getByText('写入文件')).toBeVisible();
    expect(within(toolCall).getByText('write')).toBeVisible();
    expect(within(toolCall).getByText('失败')).toBeVisible();
    expect(toolCall).toHaveTextContent('output/model.sysml');
    expect(toolCall).toHaveTextContent('EACCES');
    expect(within(toolCall).queryByText('开始写入模型文件。')).not.toBeInTheDocument();

    openTraceDebug();
    const timeline = screen.getByTestId('event-timeline-trace-failed-tool-session-1');
    expect(timeline.querySelectorAll('.agent-trace-event-row')).toHaveLength(3);
    fireEvent.click(screen.getAllByText('原始 payload')[2]!);
    const visiblePayload = Array.from(document.querySelectorAll('.agent-trace-payload'))
      .find((node) => !node.closest('.ant-collapse-content-hidden'));
    expect(visiblePayload).toBeVisible();
    expect(visiblePayload).toHaveTextContent('EACCES');
  });

  it('缺失 toolCallId 时不合并不相关的工具事件', () => {
    const session = createTraceSession(
      'trace-missing-tool-id-session',
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-missing-tool-id-session',
          sequence: 1,
          timestamp: '2026-07-13T00:00:00.000Z',
          phase: 'model-draft',
          type: 'tool-call-start',
          rawKind: 'tool_execution_start',
          message: '读取参考文件。',
          payload: { type: 'tool_execution_start', toolName: 'read' },
          toolCallId: '',
          toolName: 'read',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-missing-tool-id-session',
          sequence: 2,
          timestamp: '2026-07-13T00:00:00.100Z',
          phase: 'model-draft',
          type: 'tool-call-start',
          rawKind: 'tool_execution_start',
          message: '写入模型文件。',
          payload: { type: 'tool_execution_start', toolName: 'write' },
          toolCallId: '',
          toolName: 'write',
        },
      ],
      '2026-07-13T00:00:00.200Z',
    );

    render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false }));
    openTracePhase('模型生成');

    const readCall = screen.getByTestId('tool-call-sequence-1');
    const writeCall = screen.getByTestId('tool-call-sequence-2');
    expect(within(readCall).getByText('读取文件')).toBeVisible();
    expect(within(writeCall).getByText('写入文件')).toBeVisible();
    expect(within(readCall).getByText('读取参考文件。')).toBeVisible();
    expect(within(writeCall).getByText('写入模型文件。')).toBeVisible();
  });

  it('并发工具调用交错时聚合为独立工具块并按需保留调试时间线', () => {
    const session = createTraceSession(
      'trace-interleaved-tools-session',
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-interleaved-tools-session',
          sequence: 1,
          timestamp: '2026-07-13T00:00:00.000Z',
          phase: 'model-draft',
          type: 'tool-call-start',
          rawKind: 'tool_execution_start',
          message: '工具 A 开始。',
          payload: { type: 'tool_execution_start', toolCallId: 'call-a', toolName: 'read' },
          toolCallId: 'call-a',
          toolName: 'read',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-interleaved-tools-session',
          sequence: 2,
          timestamp: '2026-07-13T00:00:00.100Z',
          phase: 'model-draft',
          type: 'tool-call-start',
          rawKind: 'tool_execution_start',
          message: '工具 B 开始。',
          payload: { type: 'tool_execution_start', toolCallId: 'call-b', toolName: 'write' },
          toolCallId: 'call-b',
          toolName: 'write',
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-interleaved-tools-session',
          sequence: 3,
          timestamp: '2026-07-13T00:00:00.200Z',
          phase: 'model-draft',
          type: 'tool-call-end',
          rawKind: 'tool_execution_end',
          message: '工具 B 完成。',
          payload: { type: 'tool_execution_end', toolCallId: 'call-b', toolName: 'write', isError: false },
          toolCallId: 'call-b',
          toolName: 'write',
          isError: false,
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-interleaved-tools-session',
          sequence: 4,
          timestamp: '2026-07-13T00:00:00.300Z',
          phase: 'model-draft',
          type: 'tool-call-end',
          rawKind: 'tool_execution_end',
          message: '工具 A 完成。',
          payload: { type: 'tool_execution_end', toolCallId: 'call-a', toolName: 'read', isError: false },
          toolCallId: 'call-a',
          toolName: 'read',
          isError: false,
        },
      ],
      '2026-07-13T00:00:00.400Z',
    );

    const { container } = render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false }));
    openTracePhase('模型生成');

    expect(screen.getByTestId('tool-call-call-a')).toBeVisible();
    expect(screen.getByTestId('tool-call-call-b')).toBeVisible();
    expect(container.querySelector('.agent-trace-event-row')).not.toBeInTheDocument();
    openTraceDebug();
    const timeline = screen.getByTestId('event-timeline-trace-interleaved-tools-session-1');
    const visibleSequences = Array.from(timeline.querySelectorAll('.agent-trace-event-meta code'))
      .map((node) => node.textContent);
    expect(visibleSequences).toEqual(['#1', '#2', '#3', '#4']);
  });

  it('phase 重入时为每段阶段生成唯一折叠分组', () => {
    const session = createTraceSession(
      'trace-phase-reentry-session',
      [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-phase-reentry-session',
          sequence: 1,
          timestamp: '2026-07-13T00:00:00.000Z',
          phase: 'extraction',
          type: 'progress',
          rawKind: 'progress',
          message: '第一次抽取',
          payload: { percent: 10 },
          percent: 10,
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-phase-reentry-session',
          sequence: 2,
          timestamp: '2026-07-13T00:00:01.000Z',
          phase: 'validation',
          type: 'progress',
          rawKind: 'progress',
          message: '执行校验',
          payload: { percent: 50 },
          percent: 50,
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'trace-phase-reentry-session',
          sequence: 3,
          timestamp: '2026-07-13T00:00:02.000Z',
          phase: 'extraction',
          type: 'progress',
          rawKind: 'progress',
          message: '第二次抽取',
          payload: { percent: 90 },
          percent: 90,
        },
      ],
      '2026-07-13T00:00:03.000Z',
    );

    render(React.createElement(AgentExecutionTrace, { sessions: [session], busy: false }));
    expect(screen.getByText('需求抽取')).toBeVisible();
    expect(screen.getByText('结果校验')).toBeVisible();
    expect(screen.getByText('需求抽取 · 第 2 段')).toBeVisible();
    openTracePhase('需求抽取');
    openTracePhase('需求抽取 · 第 2 段');
    expect(screen.getByText('第一次抽取')).toBeVisible();
    expect(screen.getByText('第二次抽取')).toBeVisible();
  });

  it('等待 Tauri 实时监听就绪后再发起 Agent 请求', async () => {
    enableTauriRuntime();
    const stream = installDeferredEventStream();
    const extractionSession = createTraceSession(
      'listener-ready-session',
      [{ type: 'extraction', message: '已抽取确认候选项。', confirmedData: extractTianwen2ConfirmedData(sourceText) }],
      '2026-07-13T00:00:00.000Z',
    );
    tauriInvokeMock.mockImplementation(buildDesktopInvoke({
      start_agent_sidecar: { state: 'running', pid: 4242, endpoint: 'local://agent-sidecar/listener-ready' },
      extract_agent_candidates: extractionSession,
    }));

    render(React.createElement(App));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新建项目 \/ 导入材料/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /新建项目 \/ 导入材料/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /抽取候选/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /抽取候选/ }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(tauriInvokeMock.mock.calls.some(([command]) => command === 'extract_agent_candidates')).toBe(false);

    await act(async () => {
      stream.releaseRegistration();
      await Promise.resolve();
    });
    expect(await screen.findByText(/候选使命/)).toBeVisible();
    expect(tauriInvokeMock.mock.calls.some(([command]) => command === 'extract_agent_candidates')).toBe(true);
  });

  it('监听未就绪时取消不会在就绪后启动 Agent 请求', async () => {
    enableTauriRuntime();
    const stream = installDeferredEventStream();
    const extractionSession = createTraceSession(
      'cancelled-listener-session',
      [{ type: 'extraction', message: '不应返回的候选项。', confirmedData: extractTianwen2ConfirmedData(sourceText) }],
      '2026-07-13T00:00:00.000Z',
    );
    tauriInvokeMock.mockImplementation(buildDesktopInvoke({
      start_agent_sidecar: { state: 'running', pid: 4242, endpoint: 'local://agent-sidecar/cancelled-listener' },
      extract_agent_candidates: extractionSession,
    }));

    render(React.createElement(App));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新建项目 \/ 导入材料/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /新建项目 \/ 导入材料/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /抽取候选/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /抽取候选/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: '取消当前步骤' }))[0]!);

    await act(async () => {
      stream.releaseRegistration();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tauriInvokeMock.mock.calls.some(([command]) => command === 'start_agent_sidecar')).toBe(false);
    expect(tauriInvokeMock.mock.calls.some(([command]) => command === 'extract_agent_candidates')).toBe(false);
    expect(screen.getByText(/当前 SDK Agent 任务已取消/)).toBeVisible();
  });

  it('请求发出后取消会拒绝尚未归属的晚到实时会话', async () => {
    enableTauriRuntime();
    const stream = installDeferredEventStream();
    stream.releaseRegistration();
    const extractionSession = createTraceSession(
      'cancelled-inflight-session',
      [{ type: 'extraction', message: '取消后的最终结果。', confirmedData: extractTianwen2ConfirmedData(sourceText) }],
      '2026-07-13T00:00:01.000Z',
    );
    const extractionDeferred = Promise.withResolvers<typeof extractionSession>();
    tauriInvokeMock.mockImplementation(buildDesktopInvoke({
      start_agent_sidecar: { state: 'running', pid: 4242, endpoint: 'local://agent-sidecar/cancelled-inflight' },
      stop_agent_sidecar: { state: 'stopped', pid: null, endpoint: null },
      extract_agent_candidates: extractionDeferred.promise,
    }));

    render(React.createElement(App));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新建项目 \/ 导入材料/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /新建项目 \/ 导入材料/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /抽取候选/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /抽取候选/ }));
    await waitFor(() => {
      expect(tauriInvokeMock.mock.calls.some(([command]) => command === 'extract_agent_candidates')).toBe(true);
    });
    fireEvent.click((await screen.findAllByRole('button', { name: '取消当前步骤' }))[0]!);

    const lateEvent = createTraceSession(
      'late-cancelled-session',
      [{ type: 'progress', message: '取消后晚到事件。', percent: 50 }],
      '2026-07-13T00:00:02.000Z',
    ).events[0]!;
    await act(async () => {
      stream.emit(lateEvent);
      const frame = Promise.withResolvers<void>();
      window.requestAnimationFrame(() => frame.resolve());
      await frame.promise;
    });

    expect(screen.queryByText('late-cancelled-session')).not.toBeInTheDocument();
    await act(async () => {
      extractionDeferred.resolve(extractionSession);
      await extractionDeferred.promise;
    });
  });

  it('保存并重载后仍在工作区显示持久化执行轨迹', async () => {
    enableTauriRuntime();
    const confirmedData = extractTianwen2ConfirmedData(sourceText);
    const draft = await createValidAgentDraft('persisted-trace-draft-session');
    const extractionSession = createTraceSession(
      'persisted-trace-extraction-session',
      [{ type: 'extraction', message: '已抽取确认候选项。', confirmedData }],
      '2026-07-10T00:00:05.000Z',
    );
    const draftSession = createLegacyAgentModelingSession({
      sessionId: 'persisted-trace-draft-session',
      provider: 'test-provider',
      model: 'test-model',
      completedAt: '2026-07-10T00:00:06.000Z',
      events: [
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'persisted-trace-draft-session',
          sequence: 1,
          timestamp: '2026-07-10T00:00:05.100Z',
          phase: 'model-draft',
          type: 'reasoning-start',
          rawKind: 'thinking_start',
          message: '模型进入 reasoning 阶段。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } },
          contentIndex: 0,
        },
        {
          protocolVersion: 'mbse-agent-trace.v1',
          sessionId: 'persisted-trace-draft-session',
          sequence: 2,
          timestamp: '2026-07-10T00:00:05.200Z',
          phase: 'model-draft',
          type: 'reasoning-delta',
          rawKind: 'thinking_delta',
          message: '模型正在进行 reasoning。',
          payload: { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '复核 SysML source set' } },
          contentIndex: 0,
          text: '复核 SysML source set',
        },
        { type: 'model-draft', message: '模型草案已通过基础 schema 与引用校验。', draft },
      ],
    });
    let savedProjectState: Record<string, unknown> | null = null;

    tauriInvokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'agent_sidecar_status') return { state: 'stopped', pid: null, endpoint: null };
      if (command === 'load_workbench_project') {
        if (savedProjectState) {
          return savedProjectState;
        }
        throw new Error('工作台项目状态文件不存在');
      }
      if (command === 'save_workbench_project') {
        savedProjectState = {
          ...(args?.project as Record<string, unknown>),
          projectRoot: 'local/project-root',
          savedAt: '2026-07-13T00:00:00.000Z',
        };
        return savedProjectState;
      }
      if (command === 'export_workbench_project') return null;
      if (command === 'start_agent_sidecar') return { state: 'running', pid: 4242, endpoint: 'local://agent-sidecar/persisted-trace' };
      if (command === 'extract_agent_candidates') return extractionSession;
      if (command === 'generate_agent_model_draft') return draftSession;
      throw new Error(`未预期的 Tauri 命令：${command}`);
    });

    const firstRender = render(React.createElement(App));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新建项目 \/ 导入材料/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /新建项目 \/ 导入材料/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /抽取候选/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /抽取候选/ }));
    expect(await screen.findByText(/候选使命/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /确认候选并生成最终模型工件/ }));
    expect(await screen.findByText(/SDK Agent 最终模型摘要/)).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: /确认 Agent 工件并保存到工作台/ }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /材料导入与确认向导/ })).not.toBeInTheDocument();
    });
    expect(screen.getByText('已保存的 Agent 执行轨迹')).toBeVisible();
    expect((savedProjectState as { agentTraceSessions?: unknown[] } | null)?.agentTraceSessions?.length).toBe(2);

    firstRender.unmount();
    render(React.createElement(App));
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: '建模工作区视图导航' })).toBeVisible();
    });
    fireEvent.click(screen.getByText('已保存的 Agent 执行轨迹'));
    openTracePhase('模型生成');
    expect(screen.getByText('复核 SysML source set')).toBeVisible();
    openTraceDebug();
    fireEvent.click(screen.getAllByText('原始 payload')[0]!);
    await waitFor(() => {
      const payloads = Array.from(document.querySelectorAll('.agent-trace-payload')).map((node) => node.textContent ?? '');
      expect(payloads.some((text) => text.includes('thinking_start'))).toBe(true);
    });
  });
});
