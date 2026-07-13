import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createAgentSession, discoverAuthStorage, ModelRegistry, SessionManager } from '@oh-my-pi/pi-coding-agent';
import { defaultTianwen2ConfirmedData } from '../src/domain/modelGeneration.ts';
import { generateTianwen2ModelArtifacts } from '../src/domain/modelGeneration.node.ts';
import { createTraceCollector, forwardSdkSessionEvent, safeErrorMessage } from './agent-trace-protocol.mjs';
import { emitSidecarFailure } from './agent-sdk-sidecar-failure.mjs';
import { createAgentToolPolicyExtension, ensureRequiredToolsActive } from './agent-tool-policy.mjs';
import { createCandidateVerificationGate } from './candidate-verification-tool.mjs';
import { createCandidateWorkspace } from './candidate-workspace.mjs';
import { buildExtractionPrompt, collectResearchedSourceUrls, reconcileExtractionDisclosures, validateExtractionDisclosures } from './extraction-task.mjs';
import { createModelingWorkspace, modelingWorkspacePaths } from './modeling-workspace.mjs';
import { buildWorkspaceModelingPrompt, WORKSPACE_EXECUTION_GUIDANCE } from './modeling-task.mjs';
import { promptUntilSuccessfulYield } from './yield-termination.mjs';

const CONFIRMED_DATA_SCHEMA = {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', minLength: 1 },
        packageName: { type: 'string', minLength: 1 },
        mission: { type: 'string', minLength: 1 },
        requirements: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1 },
              title: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
              parentId: { type: ['string', 'null'] },
              tracedTo: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            },
            required: ['id', 'title', 'text', 'parentId', 'tracedTo'],
          },
        },
        subsystems: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1 },
              name: { type: 'string', minLength: 1 },
              parentId: { type: ['string', 'null'] },
            },
            required: ['id', 'name', 'parentId'],
          },
        },
        activities: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1 },
              title: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
              requirementIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
              performedBy: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            },
            required: ['id', 'title', 'text', 'requirementIds', 'performedBy'],
          },
        },
        interfaces: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1 },
              label: { type: 'string', minLength: 1 },
              kind: { enum: ['sample', 'data', 'power', 'thermal', 'control'] },
              interfaceId: { type: 'string', minLength: 1 },
              sourceSubsystemId: { type: 'string', minLength: 1 },
              sourcePortId: { type: 'string', minLength: 1 },
              sourcePortLabel: { type: 'string', minLength: 1 },
              targetSubsystemId: { type: 'string', minLength: 1 },
              targetPortId: { type: 'string', minLength: 1 },
              targetPortLabel: { type: 'string', minLength: 1 },
              requirementIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            },
            required: [
              'id',
              'label',
              'kind',
              'interfaceId',
              'sourceSubsystemId',
              'sourcePortId',
              'sourcePortLabel',
              'targetSubsystemId',
              'targetPortId',
              'targetPortLabel',
              'requirementIds',
            ],
          },
        },
        constraints: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1 },
              label: { type: 'string', minLength: 1 },
              expression: { type: 'string', minLength: 1 },
              relatedElementIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
              requirementIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            },
            required: ['id', 'label', 'expression', 'relatedElementIds', 'requirementIds'],
          },
        },
        parameters: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1 },
              label: { type: 'string', minLength: 1 },
              unit: { type: 'string', minLength: 1 },
              unitSymbol: { type: 'string', minLength: 1 },
              relatedElementIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            },
            required: ['id', 'label', 'unit', 'unitSymbol', 'relatedElementIds'],
          },
        },
        bindings: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1 },
              kind: { const: 'binding' },
              constraintId: { type: 'string', minLength: 1 },
              parameterId: { type: 'string', minLength: 1 },
              label: { type: 'string', minLength: 1 },
              relatedElementIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            },
            required: ['id', 'kind', 'constraintId', 'parameterId', 'label', 'relatedElementIds'],
          },
        },
      },
      required: ['projectId', 'packageName', 'mission', 'requirements', 'subsystems', 'activities', 'interfaces', 'constraints', 'parameters', 'bindings'],
};

const EXTRACTION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string', minLength: 1 },
          recommendation: { type: 'string', minLength: 1 },
          severity: { enum: ['info', 'warning'] },
          confidence: { enum: ['high', 'medium', 'low'] },
          category: { enum: ['external-source', 'engineering-assumption', 'open-question'] },
          sourceUrls: { type: 'array', items: { type: 'string', minLength: 1 } },
          affectedElements: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
        },
        required: ['message', 'recommendation', 'severity', 'category', 'confidence', 'sourceUrls', 'affectedElements'],
      },
    },
  },
  required: ['suggestions'],
};

const BASE_SYSTEM_PROMPT = [
  '你是 MBSE 建模工作台的本地 Agent Sidecar。',
  '你必须通过 oh-my-pi SDK 的真实 Agent 会话工作。',
  '你绝不能把默认天问二号模板、占位字段、外部资料或未标注推断伪装成用户原文事实；任务允许的公开资料检索和显式建模假设必须保留依据。',
  '验证失败时必须继续修正或显式报告失败，绝不能把错误结果伪装为成功。',
  '严格遵守当前任务声明的 verify 与 yield 契约。',
].join('\n');
export const DEFAULT_AGENT_MODEL_PATTERN = 'openai-codex/gpt-5.6-sol';



function writeFrame(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function createLiveTrace(sessionId, provider, model) {
  return createTraceCollector({
    sessionId,
    provider,
    model,
    emitFrame(event) {
      writeFrame({ ok: true, event });
    },
  });
}

function buildTraceSession(trace, { sdkSessionId, provider, model, completedAt }) {
  return {
    sessionId: sdkSessionId,
    provider,
    model,
    completedAt,
    events: trace.events,
  };
}


function uniqueStrings(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${label} 中存在空字符串。`);
    }
    if (seen.has(value)) {
      throw new Error(`${label} 中存在重复值：${value}`);
    }
    seen.add(value);
  }
  return seen;
}

function collectArray(record, key, label) {
  const value = record?.[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} 必须是非空数组。`);
  }
  return value;
}

function validateConfirmedData(confirmedData) {
  if (!confirmedData || typeof confirmedData !== 'object' || Array.isArray(confirmedData)) {
    throw new Error('Agent confirmedData 必须是对象。');
  }

  for (const field of ['projectId', 'packageName', 'mission']) {
    if (typeof confirmedData[field] !== 'string' || confirmedData[field].trim() === '') {
      throw new Error(`Agent confirmedData 缺少 ${field}。`);
    }
  }

  const requirements = collectArray(confirmedData, 'requirements', 'requirements');
  const subsystems = collectArray(confirmedData, 'subsystems', 'subsystems');
  const activities = collectArray(confirmedData, 'activities', 'activities');
  const interfaces = collectArray(confirmedData, 'interfaces', 'interfaces');
  const constraints = collectArray(confirmedData, 'constraints', 'constraints');
  const parameters = collectArray(confirmedData, 'parameters', 'parameters');
  const bindings = collectArray(confirmedData, 'bindings', 'bindings');

  const requirementIds = uniqueStrings(requirements.map((item) => item.id), 'requirements.id');
  const subsystemIds = uniqueStrings(subsystems.map((item) => item.id), 'subsystems.id');
  const subsystemNames = uniqueStrings(subsystems.map((item) => item.name), 'subsystems.name');
  const constraintIds = uniqueStrings(constraints.map((item) => item.id), 'constraints.id');
  const parameterIds = uniqueStrings(parameters.map((item) => item.id), 'parameters.id');

  for (const requirement of requirements) {
    if (typeof requirement.title !== 'string' || typeof requirement.text !== 'string') {
      throw new Error(`需求 ${requirement.id} 缺少 title/text。`);
    }
    if (requirement.parentId !== null && requirement.parentId !== undefined && !requirementIds.has(requirement.parentId)) {
      throw new Error(`需求 ${requirement.id} 的 parentId ${requirement.parentId} 不存在。`);
    }
    if (!Array.isArray(requirement.tracedTo) || requirement.tracedTo.length === 0) {
      throw new Error(`需求 ${requirement.id} 缺少 tracedTo。`);
    }
    for (const target of requirement.tracedTo) {
      if (!subsystemNames.has(target)) {
        throw new Error(`需求 ${requirement.id} 的 tracedTo ${target} 不在分系统集合中。`);
      }
    }
  }

  for (const subsystem of subsystems) {
    if (subsystem.parentId !== null && subsystem.parentId !== undefined && !subsystemIds.has(subsystem.parentId)) {
      throw new Error(`分系统 ${subsystem.id} 的 parentId ${subsystem.parentId} 不存在。`);
    }
  }

  for (const activity of activities) {
    if (!Array.isArray(activity.requirementIds) || activity.requirementIds.length === 0) {
      throw new Error(`活动 ${activity.id} 缺少 requirementIds。`);
    }
    if (!Array.isArray(activity.performedBy) || activity.performedBy.length === 0) {
      throw new Error(`活动 ${activity.id} 缺少 performedBy。`);
    }
    for (const requirementId of activity.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        throw new Error(`活动 ${activity.id} 引用了不存在的需求 ${requirementId}。`);
      }
    }
    for (const subsystemId of activity.performedBy) {
      if (!subsystemIds.has(subsystemId)) {
        throw new Error(`活动 ${activity.id} 引用了不存在的分系统 ${subsystemId}。`);
      }
    }
  }

  for (const entry of interfaces) {
    if (!subsystemIds.has(entry.sourceSubsystemId)) {
      throw new Error(`接口 ${entry.id} 引用了不存在的 sourceSubsystemId ${entry.sourceSubsystemId}。`);
    }
    if (!subsystemIds.has(entry.targetSubsystemId)) {
      throw new Error(`接口 ${entry.id} 引用了不存在的 targetSubsystemId ${entry.targetSubsystemId}。`);
    }
    if (!Array.isArray(entry.requirementIds) || entry.requirementIds.length === 0) {
      throw new Error(`接口 ${entry.id} 缺少 requirementIds。`);
    }
    for (const requirementId of entry.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        throw new Error(`接口 ${entry.id} 引用了不存在的需求 ${requirementId}。`);
      }
    }
  }

  for (const constraint of constraints) {
    if (!Array.isArray(constraint.requirementIds) || constraint.requirementIds.length === 0) {
      throw new Error(`约束 ${constraint.id} 缺少 requirementIds。`);
    }
    for (const requirementId of constraint.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        throw new Error(`约束 ${constraint.id} 引用了不存在的需求 ${requirementId}。`);
      }
    }
  }

  for (const binding of bindings) {
    if (binding.kind !== 'binding') {
      throw new Error(`绑定 ${binding.id} 的 kind 必须是 binding。`);
    }
    if (!constraintIds.has(binding.constraintId)) {
      throw new Error(`绑定 ${binding.id} 引用了不存在的 constraintId ${binding.constraintId}。`);
    }
    if (!parameterIds.has(binding.parameterId)) {
      throw new Error(`绑定 ${binding.id} 引用了不存在的 parameterId ${binding.parameterId}。`);
    }
  }
}

export async function createSdkSession({
  outputSchema,
  systemPrompt,
  cwd,
  customTools,
  requireYieldTool = true,
  extensions = [],
  requiredToolNames = [],
  allBuiltInTools = false,
  toolNames = [],
}) {
  const authStorage = await discoverAuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);
  await modelRegistry.refresh();
  const requestedModelPattern = process.env.MBSE_AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL_PATTERN;
  const requestedThinkingLevel = process.env.MBSE_AGENT_THINKING_LEVEL?.trim();
  const { session, modelFallbackMessage } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    modelPattern: requestedModelPattern,
    thinkingLevel: requestedThinkingLevel || undefined,
    outputSchema,
    requireYieldTool,
    toolNames: allBuiltInTools ? undefined : toolNames,
    customTools,
    extensions,
    enableMCP: false,
    enableLsp: allBuiltInTools,
    skipPythonPreflight: !allBuiltInTools,
    hasUI: false,
    systemPrompt: (defaultPrompt) => [...defaultPrompt, `${BASE_SYSTEM_PROMPT}\n${systemPrompt}`],
  });

  if (!session.model) {
    await session.dispose();
    throw new Error('Sidecar 预检失败：未找到可用模型。请先在 oh-my-pi 中完成模型登录。');
  }

  const apiKey = await modelRegistry.getApiKey(session.model, session.sessionId);
  if (!apiKey) {
    const provider = session.model.provider;
    const model = session.model.id;
    await session.dispose();
    throw new Error(`Sidecar 预检失败：未找到 ${provider}/${model} 的可用凭据。`);
  }

  let activeToolNames = typeof session.getActiveToolNames === 'function' ? session.getActiveToolNames() : [];
  if (requiredToolNames.length > 0) {
    try {
      activeToolNames = await ensureRequiredToolsActive(session, requiredToolNames);
    } catch (error) {
      await session.dispose();
      throw error;
    }
  }

  return { session, modelFallbackMessage, activeToolNames };
}


async function runStructuredAgentTurn({
  sourceText,
  outputSchema,
  systemPrompt,
  promptText,
  phase,
  phaseStep,
  cwd,
  customTools,
  extensions = [],
  requiredToolNames = [],
  toolNames = [],
  allBuiltInTools = false,
}) {
  const { session, modelFallbackMessage, activeToolNames } = await createSdkSession({
    outputSchema,
    systemPrompt,
    cwd,
    customTools,
    extensions,
    requiredToolNames,
    toolNames,
    allBuiltInTools,
  });
  const trace = createLiveTrace(
    session.sessionId,
    session.model?.provider ?? 'unknown-provider',
    session.model?.id ?? 'unknown-model',
  );
  trace.emitSessionStarted({
    fallbackMessage: modelFallbackMessage ?? null,
    activeToolNames,
    requiredToolNames,
  });
  if (requiredToolNames.length > 0) {
    trace.emitProgress(
      `已确认本阶段必需工具可见：${requiredToolNames.join('、')}。`,
      5,
      phase,
      { stage: 'required-tools-active', activeToolNames, requiredToolNames },
    );
  }
  trace.emitPhase(phase, 'started', phaseStep, { fallbackMessage: modelFallbackMessage ?? null });

  let yieldDetails;

  try {
    await promptUntilSuccessfulYield({
      session,
      promptText,
      onEvent: (event) => {
        const forwarded = forwardSdkSessionEvent(trace, event, phase);
        if (
          forwarded?.kind === 'tool-call-end'
          && forwarded.toolName === 'yield'
          && forwarded.isError !== true
          && forwarded.yieldDetails
          && typeof forwarded.yieldDetails === 'object'
        ) {
          yieldDetails = forwarded.yieldDetails;
        }
      },
    });

    if (!yieldDetails || typeof yieldDetails !== 'object') {
      throw new Error('建模 Agent 未通过 yield 返回结构化结果。');
    }
    if (yieldDetails.status !== 'success') {
      throw new Error(typeof yieldDetails.error === 'string' ? yieldDetails.error : '建模 Agent 未完成结构化输出。');
    }
    if (yieldDetails.schemaOverridden === true) {
      throw new Error('建模 Agent 输出触发了 yield schemaOverridden，结果不可保存。');
    }
    if (yieldDetails.data === undefined || yieldDetails.data === null) {
      throw new Error('建模 Agent 返回了空数据。');
    }

    return {
      trace,
      data: yieldDetails.data,
      provider: session.model?.provider ?? 'unknown-provider',
      model: session.model?.id ?? 'unknown-model',
      sdkSessionId: session.sessionId,
      completedAt: new Date().toISOString(),
      modelFallbackMessage,
    };
  } catch (error) {
    emitSidecarFailure(trace, error, phase, `${phase}-failed`, { fallbackMessage: modelFallbackMessage ?? null });
    throw error;
  } finally {
    await session.dispose();
  }
}


async function runWorkspaceModelingTurn({ sourceText, confirmedData }) {
  const workspace = await createModelingWorkspace({ confirmedData, sourceText });
  const requiredToolNames = ['read', 'write', 'edit', 'verify', 'yield'];
  let session;
  let trace;
  let modelFallbackMessage = null;
  try {
    const created = await createSdkSession({
      outputSchema: undefined,
      systemPrompt: [
        `所有最终工件都必须调用 write 写入 ${workspace.root} 下的固定 SysML source set；后续调用 edit 修改，不要在聊天或 yield 参数中回传完整工件。`,
        'verify 已对本会话激活，可在 SysML 不完整、缺文件或有语法错误时随时调用；它会逐个固定 SysML 文件执行 strict sysml2，并从语义结果派生 JSON 视图模型。',
        'verify 是早期、反复使用的权威反馈工具，不是最终验收前置门槛；不要用 Python/eval 复刻或替代它。',
        `不要创建 ${path.join(workspace.root, 'output', 'view-model.json')}；该路径被视为违规输出。`,
        'read、write、edit、verify、yield 均为本阶段必需工具；必须实际创建五个 SysML 文件后才能完成。',
        WORKSPACE_EXECUTION_GUIDANCE,
      ].join('\n'),
      cwd: workspace.root,
      customTools: workspace.tools,
      extensions: [createAgentToolPolicyExtension],
      requiredToolNames,
      requireYieldTool: false,
      allBuiltInTools: true,
    });
    session = created.session;
    modelFallbackMessage = created.modelFallbackMessage ?? null;
    trace = createLiveTrace(
      session.sessionId,
      session.model?.provider ?? 'unknown-provider',
      session.model?.id ?? 'unknown-model',
    );
    trace.emitSessionStarted({
      fallbackMessage: modelFallbackMessage,
      activeToolNames: created.activeToolNames,
      requiredToolNames,
    });
    trace.emitProgress('已确认 read、write、edit、verify、yield 对建模 Agent 可见；开始自主生成最终工件。', 20, 'model-draft', {
      stage: 'workspace-ready',
      activeToolNames: created.activeToolNames,
      requiredToolNames,
    });
    trace.emitPhase('workspace', 'started', '工作区建模', { fallbackMessage: modelFallbackMessage });

    const unsubscribe = session.subscribe((event) => {
      forwardSdkSessionEvent(trace, event, 'model-draft');
    });
    try {
      await session.prompt(buildWorkspaceModelingPrompt(confirmedData, workspace.root));
      await session.waitForIdle();
    } finally {
      unsubscribe();
    }

    const completion = workspace.getCompletion();
    if (!completion) {
      throw new Error('建模 Agent 未通过工作区 yield 完成任务。请检查最后一次 verify 诊断或 Agent 错误。');
    }

    return {
      trace,
      completion,
      provider: session.model?.provider ?? 'unknown-provider',
      model: session.model?.id ?? 'unknown-model',
      sdkSessionId: session.sessionId,
      completedAt: new Date().toISOString(),
      modelFallbackMessage,
    };
  } catch (error) {
    if (trace) {
      emitSidecarFailure(trace, error, 'model-draft', 'model-draft-failed', { fallbackMessage: modelFallbackMessage });
    }
    throw error;
  } finally {
    const cleanupErrors = [];
    if (session) {
      await session.dispose().catch((error) => cleanupErrors.push(`session: ${error instanceof Error ? error.message : String(error)}`));
    }
    await workspace.dispose().catch((error) => cleanupErrors.push(`workspace: ${error instanceof Error ? error.message : String(error)}`));
    if (cleanupErrors.length > 0) {
      console.error(`[workspace-cleanup-warning] ${cleanupErrors.join('；')}`);
    }
  }
}

async function handlePreflight() {
  const { session, modelFallbackMessage } = await createSdkSession({
    outputSchema: undefined,
    systemPrompt: '当前请求仅用于预检模型与凭据，不执行建模。',
  });
  try {
    return {
      provider: session.model?.provider ?? 'unknown-provider',
      model: session.model?.id ?? 'unknown-model',
      sdkSessionId: session.sessionId,
      completedAt: new Date().toISOString(),
      fallbackMessage: modelFallbackMessage ?? null,
    };
  } finally {
    await session.dispose();
  }
}

async function handleExtractCandidates(sourceText) {
  if (typeof sourceText !== 'string' || sourceText.trim() === '') {
    throw new Error('源材料不能为空。');
  }
  const candidateWorkspace = await createCandidateWorkspace(sourceText, CONFIRMED_DATA_SCHEMA);
  const candidateVerification = createCandidateVerificationGate({
    candidatePath: candidateWorkspace.candidatePath,
    validateConfirmedData,
  });

  let result;
  try {
    result = await runStructuredAgentTurn({
      sourceText,
      outputSchema: EXTRACTION_OUTPUT_SCHEMA,
      systemPrompt: [
        '你负责把叙述性课程材料深化为可供用户确认的完整 MBSE 候选，而不是逐字段格式转换。',
        `唯一候选工件是绝对路径 ${candidateWorkspace.candidatePath}。检索结果和聊天内容都不是候选工件。`,
        `必须调用 write 创建该文件，后续调用 edit/write 修正；verify_candidate 只接受空对象 {} 并读取该文件。`,
        '候选文件通过 verify_candidate 且未再修改前，禁止调用 yield。完成时必须调用省略 type 的终止 yield，使用 result: { data: { suggestions: [...] } }；禁止 type 数组的非终止 section yield。终止 yield 成功后 Sidecar 会立即中断当前 Agent 会话。较长辅助脚本必须写入当前候选工作区 scratch/scripts/ 后用短命令执行。',
        '本会话开放 OMP 内置工具，可自主检索可信公开资料，并以系统工程推理细化需求、结构、行为、接口、约束和追溯关系；稳定 ID 由你确定性生成。',
        '公开资料、建模假设和待确认项必须按 suggestions 分类披露并标注置信度，external-source 只能引用本次会话成功网页搜索或读取结果中实际返回的 URL；不得复制默认模板或修改工作台源码。',
      ].join('\n'),
      promptText: buildExtractionPrompt(sourceText, candidateWorkspace.candidatePath),
      cwd: candidateWorkspace.root,
      customTools: [candidateVerification.tool],
      extensions: [createAgentToolPolicyExtension, candidateVerification.createYieldGuardExtension],
      requiredToolNames: ['read', 'write', 'edit', 'verify_candidate', 'yield'],
      phase: 'extraction',
      phaseStep: '候选抽取',
      allBuiltInTools: true,
    });
    result.trace.emitProgress('建模 Agent 已提交候选结果，正在执行确定性校验。', 75, 'extraction', {
      stage: 'deterministic-validation',
    });
    const payload = result.data;
    const confirmedData = await candidateVerification.requireVerifiedCandidate();
    const rawSuggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
    const researchedSourceUrls = collectResearchedSourceUrls(result.trace.events);
    const suggestions = reconcileExtractionDisclosures(rawSuggestions, researchedSourceUrls);
    validateExtractionDisclosures(suggestions, researchedSourceUrls);

    result.trace.emit({
      type: 'extraction',
      phase: 'extraction',
      rawKind: 'confirmed_data',
      message: '已通过 SDK Agent 完成候选抽取，并通过结构与引用校验。',
      payload: { confirmedData },
      confirmedData,
    });

    for (const suggestion of suggestions) {
      const sourceUrls = Array.isArray(suggestion.sourceUrls) ? suggestion.sourceUrls : [];
      const affectedElements = Array.isArray(suggestion.affectedElements) ? suggestion.affectedElements : [];
      const recommendation = [
        suggestion.recommendation,
        `置信度：${suggestion.confidence}`,
        sourceUrls.length > 0 ? `来源：${sourceUrls.join('、')}` : null,
        affectedElements.length > 0 ? `影响对象：${affectedElements.join('、')}` : null,
      ].filter(Boolean).join('；');
      result.trace.emit({
        type: 'suggestion',
        phase: 'extraction',
        rawKind: 'suggestion',
        message: suggestion.message,
        payload: suggestion,
        target: 'extraction',
        category: suggestion.category,
        confidence: suggestion.confidence,
        sourceUrls,
        affectedElements,
        recommendation,
        severity: suggestion.severity,
      });
    }

    result.trace.emitPhase('extraction', 'completed', '候选抽取', { fallbackMessage: result.modelFallbackMessage ?? null });
    result.trace.emitSessionFinished('success', result.completedAt, { fallbackMessage: result.modelFallbackMessage ?? null });
    return buildTraceSession(result.trace, result);
  } catch (error) {
    if (result?.trace) {
      emitSidecarFailure(result.trace, error, 'extraction', 'extraction-postprocess-failed');
    }
    throw error;
  } finally {
    await candidateWorkspace.dispose();
  }
}

async function handleGenerateModelDraft(sourceText, confirmedData) {
  if (typeof sourceText !== 'string' || sourceText.trim() === '') {
    throw new Error('源材料不能为空。');
  }
  validateConfirmedData(confirmedData);

  let result;
  try {
    result = await runWorkspaceModelingTurn({ sourceText, confirmedData });
    result.trace.emitProgress('建模 Agent 已通过工作区 verify 与 yield 门控。', 90, 'validation', {
      stage: 'verified',
    });

    const validation = result.completion.draft.validation;
    const draft = {
      ...result.completion.draft,
      provenance: {
        mode: 'sdk-agent',
        provider: result.provider,
        model: result.model,
        sdkSessionId: result.sdkSessionId,
        completedAt: result.completedAt,
        schemaOverridden: false,
        validationSummary: {
          valid: validation.valid,
          errorCount: validation.errors.length,
          findingCount: validation.findings.length,
        },
      },
    };

    result.trace.emit({
      type: 'model-draft',
      phase: 'model-draft',
      rawKind: 'model_draft',
      message: '已通过工作区 Agent 生成最终模型工件，并通过 verify/yield 原子门控。',
      payload: { draft, executionReport: result.completion.report ?? null },
      draft,
      executionReport: result.completion.report,
    });
    result.trace.emitPhase('workspace', 'completed', '工作区建模', { fallbackMessage: result.modelFallbackMessage ?? null });
    result.trace.emitPhase('model-draft', 'completed', '最终工件生成', { fallbackMessage: result.modelFallbackMessage ?? null });
    result.trace.emitSessionFinished('success', result.completedAt, { fallbackMessage: result.modelFallbackMessage ?? null });
    return buildTraceSession(result.trace, result);
  } catch (error) {
    if (result?.trace) {
      emitSidecarFailure(result.trace, error, 'model-draft', 'model-draft-postprocess-failed');
    }
    throw error;
  }
}

async function handleVerifyWorkspaceFixture() {
  const sourceText = 'bundled-sidecar-self-check';
  const workspace = await createModelingWorkspace({
    confirmedData: defaultTianwen2ConfirmedData,
    sourceText,
  });
  try {
    const artifacts = await generateTianwen2ModelArtifacts(defaultTianwen2ConfirmedData);
    await Promise.all(
      artifacts.sourceSet.files.map((file) =>
        writeFile(path.join(workspace.root, modelingWorkspacePaths.outputRoot, file.path), file.content, 'utf8'),
      ),
    );
    const verification = await workspace.verify();
    if (!verification.valid) {
      throw new Error(verification.diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.path} ${diagnostic.message}`).join('\n'));
    }
    return {
      verification: {
        valid: verification.valid,
        diagnostics: verification.diagnostics,
        checkedRules: verification.checkedRules,
      },
    };
  } finally {
    await workspace.dispose();
  }
}

async function handleRequest(request) {
  const action = request?.action;
  if (action === 'preflight') {
    return { ok: true, status: await handlePreflight() };
  }
  if (action === 'extract-candidates') {
    return { ok: true, session: await handleExtractCandidates(request?.sourceText ?? '') };
  }
  if (action === 'generate-model-draft') {
    if (!request?.confirmedData || typeof request.confirmedData !== 'object') {
      throw new Error('generate-model-draft 缺少 confirmedData；已禁用任何本地补齐路径。');
    }
    return {
      ok: true,
      session: await handleGenerateModelDraft(request?.sourceText ?? '', request.confirmedData),
    };
  }
  if (action === 'verify-workspace-fixture') {
    return { ok: true, verification: await handleVerifyWorkspaceFixture() };
  }
  if (action === 'shutdown') {
    return { ok: true, shutdown: true };
  }
  throw new Error(typeof action === 'string' ? `未知 Sidecar 请求：${action}` : 'Sidecar 请求缺少 action。');
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) {
      writeFrame({ ok: false, error: 'Sidecar 请求不能为空。' });
      continue;
    }
    try {
      const request = JSON.parse(line);
      const response = await handleRequest(request);
      writeFrame(response);
      if (response.shutdown === true) {
        break;
      }
    } catch (error) {
      writeFrame({ ok: false, error: safeErrorMessage(error) });
    }
  }
}

const isMainModule = (typeof import.meta === 'object' && 'main' in import.meta && import.meta.main)
  || (process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false);
if (isMainModule) {
  await main();
}
