import { describe, expect, it } from 'vitest';
import { createLegacyAgentModelingSession } from '../src/domain/agentSidecar';
import { defaultTianwen2ConfirmedData } from '../src/domain/modelGeneration';
import { loadNodeGeneratedDraft } from './helpers/generatedDraft';
import { loadBundledTianwen2Project } from '../src/domain/sampleProject';
import { createWorkbenchProjectState } from '../src/domain/workbenchProject';

const MAX_PERSISTED_AGENT_TRACE_CHARACTERS = 2_000_000;

describe('工作台 Agent 轨迹持久化边界', () => {
  it('超大运行时 payload 会被投影为有界轨迹，不阻止当前模型工件保存', () => {
    const sampleProject = loadBundledTianwen2Project();
    const oversizedPayload = 'x'.repeat(MAX_PERSISTED_AGENT_TRACE_CHARACTERS + 1);
    const session = createLegacyAgentModelingSession({
      sessionId: 'oversized-runtime-trace',
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      completedAt: '2026-07-14T00:00:01.000Z',
      events: [{
        protocolVersion: 'mbse-agent-trace.v1',
        sessionId: 'oversized-runtime-trace',
        sequence: 1,
        timestamp: '2026-07-14T00:00:00.000Z',
        phase: 'extraction',
        type: 'sdk-event',
        rawKind: 'oversized-payload',
        message: '运行时原始事件',
        payload: { raw: oversizedPayload },
      }],
    });

    const saved = createWorkbenchProjectState(sampleProject, {
      agentTraceSessions: [session],
    });
    const traceFile = saved.files.find((file) => file.path.endsWith('/agent-trace-sessions.json'));

    expect(traceFile).toBeDefined();
    expect(traceFile!.content.length).toBeLessThanOrEqual(MAX_PERSISTED_AGENT_TRACE_CHARACTERS);
    expect(saved.agentTraceSessions).toEqual(JSON.parse(traceFile!.content));
    expect(saved.agentTraceSessions?.[0]?.events[0]?.payload).toBeNull();
  });

  it('压缩超大 payload 时保留 extraction、model-draft 与 session 边界', async () => {
    const sampleProject = loadBundledTianwen2Project();
    const draft = await loadNodeGeneratedDraft();
    const base = {
      protocolVersion: 'mbse-agent-trace.v1' as const,
      sessionId: 'domain-results-trace',
      timestamp: '2026-07-14T00:00:00.000Z',
      phase: 'model-draft' as const,
      payload: null,
    };
    const session = createLegacyAgentModelingSession({
      sessionId: 'domain-results-trace',
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      completedAt: '2026-07-14T00:00:04.000Z',
      events: [
        {
          ...base,
          sequence: 1,
          type: 'session-started',
          rawKind: 'session-started',
          message: '会话开始',
        },
        {
          ...base,
          sequence: 2,
          phase: 'extraction',
          type: 'extraction',
          rawKind: 'confirmed-data',
          message: '候选完成',
          confirmedData: defaultTianwen2ConfirmedData,
        },
        {
          ...base,
          sequence: 3,
          type: 'sdk-event',
          rawKind: 'oversized-runtime-payload',
          message: '超大运行时事件',
          payload: { raw: 'x'.repeat(MAX_PERSISTED_AGENT_TRACE_CHARACTERS + 1) },
        },
        {
          ...base,
          sequence: 4,
          type: 'model-draft',
          rawKind: 'model-draft',
          message: '模型完成',
          draft,
        },
        {
          ...base,
          sequence: 5,
          phase: 'session',
          type: 'session-finished',
          rawKind: 'session-finished',
          message: '会话结束',
          status: 'success',
        },
      ],
    });

    const saved = createWorkbenchProjectState(sampleProject, {
      confirmedData: defaultTianwen2ConfirmedData,
      generatedArtifacts: draft,
      sidecarDraft: draft,
      agentTraceSessions: [session],
    });
    const persistedEvents = saved.agentTraceSessions?.[0]?.events ?? [];

    expect(persistedEvents.map((event) => event.type)).toEqual([
      'session-started',
      'extraction',
      'sdk-event',
      'model-draft',
      'session-finished',
    ]);
    expect(persistedEvents.find((event) => event.type === 'extraction'))
      .toMatchObject({ confirmedData: defaultTianwen2ConfirmedData });
    expect(persistedEvents.find((event) => event.type === 'model-draft'))
      .toMatchObject({ draft });
    expect(persistedEvents[2]?.payload).toBeNull();
  });
});
