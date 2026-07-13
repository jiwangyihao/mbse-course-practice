import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createAgentSession, discoverAuthStorage, ModelRegistry, SessionManager } from '@oh-my-pi/pi-coding-agent';
import { defaultTianwen2ConfirmedData } from '../src/domain/modelGeneration.ts';
import { generateTianwen2ModelArtifacts } from '../src/domain/modelGeneration.node.ts';
import { createModelingWorkspace, modelingWorkspacePaths } from './modeling-workspace.mjs';

const EXTRACTION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    confirmedData: {
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
    },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message: { type: 'string', minLength: 1 },
          recommendation: { type: 'string', minLength: 1 },
          severity: { enum: ['info', 'warning'] },
        },
        required: ['message', 'recommendation', 'severity'],
      },
    },
  },
  required: ['confirmedData', 'suggestions'],
};

const BASE_SYSTEM_PROMPT = [
  '你是 MBSE 建模工作台的本地 Agent Sidecar。',
  '你必须通过 oh-my-pi SDK 的真实 Agent 会话工作。',
  '你绝不能使用默认天问二号模板、占位字段、猜测性补齐或本地规则回退。',
  '验证失败时必须继续修正或显式报告失败，绝不能把错误结果伪装为成功。',
  '严格遵守当前任务声明的 verify 与 yield 契约。',
].join('\n');

function writeFrame(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function emitProgress(events, message, percent) {
  const event = { type: 'progress', message, percent };
  events.push(event);
  writeFrame({ ok: true, event });
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







async function createSdkSession({
  outputSchema,
  systemPrompt,
  cwd,
  customTools,
  requireYieldTool = true,
  allBuiltInTools = false,
}) {
  const authStorage = await discoverAuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);
  await modelRegistry.refresh();
  const requestedModelPattern = process.env.MBSE_AGENT_MODEL?.trim();
  const requestedThinkingLevel = process.env.MBSE_AGENT_THINKING_LEVEL?.trim();
  const { session, modelFallbackMessage } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    modelPattern: requestedModelPattern || undefined,
    thinkingLevel: requestedThinkingLevel || undefined,
    outputSchema,
    requireYieldTool,
    toolNames: allBuiltInTools ? undefined : [],
    customTools,
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

  return { session, modelFallbackMessage };
}

function buildExtractionPrompt(sourceText) {
  return [
    '请从以下材料中提取 MBSE 建模确认候选。',
    '必须只基于材料内容给出结果，不得补齐默认天问二号数据。',
    '若材料不足以形成完整候选，请调用 yield 返回 error，明确指出缺失字段。',
    '字段约束：mission 必须概括使命目标；requirements[].tracedTo 必须填写分系统名称；requirements[].parentId 与 subsystems[].parentId 仅在存在父元素时填写其稳定 ID，根元素填写 null；activities[].requirementIds、interfaces[].requirementIds 必须填写需求 ID；activities[].performedBy、interfaces[].sourceSubsystemId、interfaces[].targetSubsystemId、constraints[].relatedElementIds、parameters[].relatedElementIds、bindings[].relatedElementIds 必须填写分系统或元素 ID。',
    'confirmedData 必须完整覆盖 requirements、subsystems、activities、interfaces、constraints、parameters、bindings；suggestions 请返回 1~3 条用户可执行修正建议。',
    '',
    '材料：',
    sourceText,
  ].join('\n');
}



async function runStructuredAgentTurn({ sourceText, confirmedData, outputSchema, systemPrompt, promptText }) {
  const { session, modelFallbackMessage } = await createSdkSession({ outputSchema, systemPrompt });
  let yieldDetails;
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'tool_execution_end' && event.toolName === 'yield' && event.isError !== true) {
      const details = event.result?.details;
      if (details && typeof details === 'object') {
        yieldDetails = details;
      }
    }
  });

  try {
    await session.prompt(promptText);
    await session.waitForIdle();

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
      data: yieldDetails.data,
      provider: session.model?.provider ?? 'unknown-provider',
      model: session.model?.id ?? 'unknown-model',
      sdkSessionId: session.sessionId,
      completedAt: new Date().toISOString(),
      modelFallbackMessage,
    };
  } finally {
    unsubscribe();
    await session.dispose();
  }
}

function buildWorkspaceModelingPrompt(confirmedData) {
  return [
    '在当前工作目录内完成最终 MBSE 工件。',
    '先阅读 WORKSPACE.md、input/confirmed-data.json、references/ 下的规范、ADR 和示例。',
    'input/confirmed-data.json 是唯一业务事实来源；示例只用于理解语法和数据结构。',
    `必须创建并维护以下 SysML 源文件：${modelingWorkspacePaths.files.join('、')}。`,
    `禁止创建 ${modelingWorkspacePaths.forbiddenViewModel}；JSON 视图模型由 verify/yield 从 strict sysml2 语义自动派生。`,
    '你可以使用本会话开放的 OMP 内置工具自主探索、编写和修正文件，但应把工作限制在当前约定式工作目录。',
    '完成初稿后调用 verify；根据每条路径化诊断迭代修正，直到 verify passed。',
    '只有确信工作完全完成且 verify 已通过后才能调用 yield。',
    `当前 projectId=${confirmedData.projectId}，packageName=${confirmedData.packageName}。`,
  ].join('\n');
}

async function runWorkspaceModelingTurn({ sourceText, confirmedData }) {
  const workspace = await createModelingWorkspace({ confirmedData, sourceText });
  let session;
  try {
    const created = await createSdkSession({
      outputSchema: undefined,
      systemPrompt: [
        '所有最终工件都必须写入固定 SysML source set；不要在聊天或 yield 参数中回传完整工件。',
        'verify 会逐个 SysML 文件执行 strict sysml2，并仅从语义结果派生 JSON 视图模型。',
        '不要创建 output/view-model.json；该路径被视为违规输出。',
        '你可以自主使用 OMP 内置工具阅读参考、编写文件、运行辅助命令和迭代修正。',
      ].join('\n'),
      cwd: workspace.root,
      customTools: workspace.tools,
      requireYieldTool: false,
      allBuiltInTools: true,
    });
    session = created.session;
    await session.prompt(buildWorkspaceModelingPrompt(confirmedData));
    await session.waitForIdle();

    const completion = workspace.getCompletion();
    if (!completion) {
      throw new Error('建模 Agent 未通过工作区 yield 完成任务。请检查最后一次 verify 诊断或 Agent 错误。');
    }

    return {
      completion,
      provider: session.model?.provider ?? 'unknown-provider',
      model: session.model?.id ?? 'unknown-model',
      sdkSessionId: session.sessionId,
      completedAt: new Date().toISOString(),
      modelFallbackMessage: created.modelFallbackMessage,
    };
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

  const events = [];
  emitProgress(events, 'SDK Agent Sidecar 已通过预检，开始抽取候选。', 15);
  const result = await runStructuredAgentTurn({
    sourceText,
    confirmedData: null,
    outputSchema: EXTRACTION_OUTPUT_SCHEMA,
    systemPrompt: '你负责把课程材料提取为 confirmedData 候选。缺字段就失败，不得补齐默认数据；mission 来自使命目标摘要；requirements.tracedTo 使用分系统名称；parentId 在根元素处返回 null，其余引用字段遵循材料中的稳定 ID。',
    promptText: buildExtractionPrompt(sourceText),
  });
  emitProgress(events, '建模 Agent 已提交候选结果，正在执行确定性校验。', 75);

  const payload = result.data;
  const confirmedData = payload?.confirmedData;
  validateConfirmedData(confirmedData);

  const extractionEvent = {
    type: 'extraction',
    message: '已通过 SDK Agent 完成候选抽取，并通过结构与引用校验。',
    confirmedData,
  };
  events.push(extractionEvent);
  writeFrame({ ok: true, event: extractionEvent });

  for (const suggestion of Array.isArray(payload?.suggestions) ? payload.suggestions : []) {
    const suggestionEvent = {
      type: 'suggestion',
      message: suggestion.message,
      target: 'extraction',
      recommendation: suggestion.recommendation,
      severity: suggestion.severity,
    };
    events.push(suggestionEvent);
    writeFrame({ ok: true, event: suggestionEvent });
  }

  return {
    sessionId: result.sdkSessionId,
    provider: result.provider,
    model: result.model,
    completedAt: result.completedAt,
    events,
  };
}

async function handleGenerateModelDraft(sourceText, confirmedData) {
  if (typeof sourceText !== 'string' || sourceText.trim() === '') {
    throw new Error('源材料不能为空。');
  }
  validateConfirmedData(confirmedData);

  const events = [];
  emitProgress(events, 'SDK Agent Sidecar 已创建建模工作区，开始自主生成最终工件。', 20);
  const result = await runWorkspaceModelingTurn({ sourceText, confirmedData });
  emitProgress(events, '建模 Agent 已通过工作区 verify 与 yield 门控。', 90);

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

  const draftEvent = {
    type: 'model-draft',
    message: '已通过工作区 Agent 生成最终模型工件，并通过 verify/yield 原子门控。',
    draft,
    executionReport: result.completion.report,
  };
  events.push(draftEvent);
  writeFrame({ ok: true, event: draftEvent });

  return {
    sessionId: result.sdkSessionId,
    provider: result.provider,
    model: result.model,
    completedAt: result.completedAt,
    events,
  };
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
      writeFrame({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

const isMainModule = (typeof import.meta === 'object' && 'main' in import.meta && import.meta.main)
  || (process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false);
if (isMainModule) {
  await main();
}
