import readline from 'node:readline';
import { validateViewModel } from '../../src/domain/modelGeneration.ts';

const MISSING_BDD_VIEW_KIND = 'MISSING-BDD-VIEW-KIND';


function writeFrame(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function handle(request) {
  const action = request?.action;
  if (action === 'preflight') {
    return {
      ok: true,
      status: {
        provider: 'test-provider',
        model: 'test-model',
        sdkSessionId: 'sdk-session-preflight',
        completedAt: '2026-07-10T00:00:00.000Z',
        fallbackMessage: null,
      },
    };
  }
  if (action === 'extract-candidates') {
    const events = [];
    const progress = { type: 'progress', message: 'fixture progress', percent: 20 };
    events.push(progress);
    writeFrame({ ok: true, event: progress });
    if (String(request?.sourceText ?? '').includes('SLOW-CANCEL')) {
      await sleep(750);
    }
    const extraction = {
      type: 'extraction',
      message: 'fixture extraction',
      confirmedData: {
        projectId: 'tianwen-2',
        packageName: 'Tianwen2ConfirmedModel',
        mission: '测试任务',
        requirements: [
          { id: 'REQ-TW2-001', title: '需求1', text: '文本1', parentId: null, tracedTo: ['航天器平台'] },
          { id: 'REQ-TW2-004', title: '需求4', text: '文本4', parentId: 'REQ-TW2-001', tracedTo: ['测控通信分系统'] },
        ],
        subsystems: [
          { id: 'spacecraft-platform', name: '航天器平台', parentId: null },
          { id: 'ttc-communication', name: '测控通信分系统', parentId: 'spacecraft-platform' },
        ],
        activities: [
          { id: 'activity-1', title: '活动1', text: '活动文本', requirementIds: ['REQ-TW2-001'], performedBy: ['spacecraft-platform'] },
        ],
        interfaces: [
          {
            id: 'if-1',
            label: '接口1',
            kind: 'data',
            interfaceId: 'if-data',
            sourceSubsystemId: 'spacecraft-platform',
            sourcePortId: 'out-1',
            sourcePortLabel: '输出',
            targetSubsystemId: 'ttc-communication',
            targetPortId: 'in-1',
            targetPortLabel: '输入',
            requirementIds: ['REQ-TW2-004'],
          },
        ],
        constraints: [
          { id: 'constraint-1', label: '约束1', expression: 'a <= b', relatedElementIds: ['spacecraft-platform'], requirementIds: ['REQ-TW2-001'] },
        ],
        parameters: [
          { id: 'param-1', label: '参数1', unit: 'kg', unitSymbol: 'kg', relatedElementIds: ['spacecraft-platform'] },
        ],
        bindings: [
          { id: 'binding-1', kind: 'binding', constraintId: 'constraint-1', parameterId: 'param-1', label: '绑定1', relatedElementIds: ['spacecraft-platform'] },
        ],
      },
    };
    events.push(extraction);
    writeFrame({ ok: true, event: extraction });
    const suggestion = {
      type: 'suggestion',
      message: 'fixture suggestion',
      target: 'extraction',
      recommendation: '检查追溯覆盖',
      severity: 'warning',
    };
    events.push(suggestion);
    writeFrame({ ok: true, event: suggestion });
    if (!String(request?.sourceText ?? '').includes('REQ-')) {
      const error = { type: 'error', message: 'fixture missing req id', recoverable: true };
      events.push(error);
      writeFrame({ ok: true, event: error });
    }
    return {
      ok: true,
      session: {
        sessionId: 'sdk-session-extraction',
        provider: 'test-provider',
        model: 'test-model',
        completedAt: '2026-07-10T00:00:01.000Z',
        events,
      },
    };
  }
  if (action === 'generate-model-draft') {
    if (!request?.confirmedData) {
      return { ok: false, error: 'confirmedData required' };
    }
    const events = [];
    const progress = { type: 'progress', message: 'fixture draft progress', percent: 80 };
    events.push(progress);
    writeFrame({ ok: true, event: progress });
    if (String(request?.confirmedData?.mission ?? '').includes('SLOW-CANCEL')) {
      await sleep(750);
    }
    const suggestion = {
      type: 'suggestion',
      message: 'fixture draft suggestion',
      target: 'model-draft',
      recommendation: '检查 BDD 覆盖',
      severity: 'info',
    };
    events.push(suggestion);
    writeFrame({ ok: true, event: suggestion });
    const draft = {
      sysmlText: 'package Tianwen2ConfirmedModel {}',
      viewModel: {
        schemaVersion: '0.4.0',
        projectId: 'tianwen-2',
        source: 'sdk-agent-generated',
        generatedFrom: 'Tianwen2ConfirmedModel',
        views: [
          { id: 'requirements-view', title: '需求视图', kind: 'requirements', layout: 'auto', layoutEngine: 'deterministic-layered-layout', nodes: [], edges: [] },
          { id: 'bdd-structure-view', title: 'BDD 结构视图', kind: 'bdd', layout: 'auto', layoutEngine: 'deterministic-layered-layout', nodes: [], edges: [] },
        ],
        validation: { status: 'passed', checkedRules: ['schema'] },
      },
      validation: { valid: true, errors: [], findings: [] },
      provenance: {
        mode: 'sdk-agent',
        provider: 'test-provider',
        model: 'test-model',
        sdkSessionId: 'sdk-session-draft',
        completedAt: '2026-07-10T00:00:02.000Z',
        schemaOverridden: false,
        validationSummary: { valid: true, errorCount: 0, findingCount: 0 },
      },
    };
    if (String(request?.sourceText ?? '').includes(MISSING_BDD_VIEW_KIND)) {
      delete draft.viewModel.views[1].kind;
      const validation = validateViewModel(draft.viewModel);
      if (validation.valid) {
        throw new Error('Fixture sentinel draft unexpectedly passed view-model validation.');
      }
      return {
        ok: false,
        error: `Agent viewModel 校验失败：${validation.errors.map((item) => `${item.path} ${item.message}`).join('；')}`,
      };
    }
    const modelDraft = { type: 'model-draft', message: 'fixture draft', draft };
    events.push(modelDraft);
    writeFrame({ ok: true, event: modelDraft });
    return {
      ok: true,
      session: {
        sessionId: 'sdk-session-draft',
        provider: 'test-provider',
        model: 'test-model',
        completedAt: '2026-07-10T00:00:02.000Z',
        events,
      },
    };
  }
  if (action === 'shutdown') {
    return { ok: true, shutdown: true };
  }
  return { ok: false, error: `unknown action ${String(action)}` };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) {
    writeFrame({ ok: false, error: 'empty request' });
    continue;
  }
  try {
    const request = JSON.parse(line);
    const response = await handle(request);
    writeFrame(response);
    if (response.shutdown === true) {
      break;
    }
  } catch (error) {
    writeFrame({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
