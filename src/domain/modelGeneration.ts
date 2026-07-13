export interface ConfirmedRequirement {
  id: string;
  title: string;
  text: string;
  parentId: string | null;
  tracedTo: string[];
}

export interface ConfirmedSubsystem {
  id: string;
  name: string;
  parentId: string | null;
}

export interface ConfirmedActivity {
  id: string;
  title: string;
  text: string;
  requirementIds: string[];
  performedBy: string[];
}
export interface ConfirmedInterface {
  id: string;
  label: string;
  kind: 'sample' | 'data' | 'power' | 'thermal' | 'control';
  interfaceId: string;
  sourceSubsystemId: string;
  sourcePortId: string;
  sourcePortLabel: string;
  targetSubsystemId: string;
  targetPortId: string;
  targetPortLabel: string;
  requirementIds: string[];
}

export interface ConfirmedTianwen2Data {
  projectId: string;
  packageName: string;
  mission: string;
  requirements: ConfirmedRequirement[];
  subsystems: ConfirmedSubsystem[];
  activities: ConfirmedActivity[];
  interfaces: ConfirmedInterface[];
  constraints: ParameterConstraint[];
  parameters: ConstraintParameter[];
  bindings: ParameterBinding[];
}

export interface ModelSourceFile {
  path: string;
  content: string;
}

export interface ModelSourceSet {
  rootDir: string;
  entryPath: string;
  files: ModelSourceFile[];
}

export interface ViewPort {
  id: string;
  label: string;
  kind: 'sample' | 'data' | 'power' | 'thermal' | 'control';
  ownerId: string;
  interfaceId: string;
}

export interface ViewNode {
  id: string;
  kind: 'mission' | 'requirement' | 'subsystem' | 'system' | 'activity' | 'ibd-part' | 'constraint' | 'parameter';
  label: string;
  text?: string;
  elementId?: string;
  ports?: ViewPort[];
  position: {
    x: number;
    y: number;
  };
}

export interface ViewEdge {
  id: string;
  kind: 'hierarchy' | 'trace' | 'composition' | 'flow' | 'connection' | 'binding';
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  label?: string;
}

export interface ViewConnection {
  id: string;
  kind: 'connection' | 'connector';
  source: string;
  target: string;
  sourcePort: string;
  targetPort: string;
  label: string;
}

export interface TraceabilityMatrixColumn {
  id: string;
  elementId: string;
  kind: 'structure' | 'behavior' | 'interface' | 'constraint';
  label: string;
}

export interface TraceabilityMatrixRow {
  id: string;
  requirementId: string;
  label: string;
}

export interface TraceabilityMatrixCell {
  rowId: string;
  requirementId: string;
  columnId: string;
  covered: boolean;
  evidence?: string;
}

export interface ParameterConstraint {
  id: string;
  label: string;
  expression: string;
  relatedElementIds: string[];
  requirementIds: string[];
}

export interface ConstraintParameter {
  id: string;
  label: string;
  unit: string;
  unitSymbol: string;
  relatedElementIds: string[];
}

export interface ParameterBinding {
  id: string;
  kind: 'binding';
  constraintId: string;
  parameterId: string;
  label: string;
  relatedElementIds: string[];
}

export interface GeneratedView {
  id: string;
  title: string;
  kind: 'requirements' | 'bdd' | 'activity' | 'traceability-matrix' | 'ibd' | 'parameter-constraints';
  layout: 'auto';
  layoutEngine: 'deterministic-layered-layout' | 'matrix-layout' | 'elk-layered';
  nodes: ViewNode[];
  edges: ViewEdge[];
  ports?: ViewPort[];
  connections?: ViewConnection[];
  rows?: TraceabilityMatrixRow[];
  columns?: TraceabilityMatrixColumn[];
  cells?: TraceabilityMatrixCell[];
  constraints?: ParameterConstraint[];
  parameters?: ConstraintParameter[];
  bindings?: ParameterBinding[];
}

export interface GeneratedViewModel {
  schemaVersion: string;
  projectId: string;
  source: 'sysml-source-set-derived';
  generatedFrom: string;
  views: GeneratedView[];
  validation: {
    status: 'passed' | 'failed';
    checkedRules: string[];
  };
}
export interface AgentGenerationProvenance {
  mode: 'sdk-agent';
  provider: string;
  model: string;
  sdkSessionId: string;
  completedAt: string;
  schemaOverridden: boolean;
  validationSummary: {
    valid: boolean;
    errorCount: number;
    findingCount: number;
  };
}


export interface ModelGenerationResult {
  sourceSet: ModelSourceSet;
  viewModel: GeneratedViewModel;
  validation: ViewModelValidationResult;
  provenance?: AgentGenerationProvenance;
}

export interface ViewModelValidationError {
  code: 'schema' | 'missing-reference' | 'missing-endpoint' | 'invalid-connection' | 'missing-parameter' | 'missing-unit' | 'missing-binding';
  message: string;
  path: string;
}

export interface ViewModelValidationFinding {
  code: 'uncovered-requirement';
  severity: 'warning';
  message: string;
  path: string;
  elementId: string;
  requirementId: string;
  viewId: string;
}

export interface ViewModelValidationResult {
  valid: boolean;
  errors: ViewModelValidationError[];
  findings: ViewModelValidationFinding[];
}

const fallbackActivities: ConfirmedActivity[] = [
  {
    id: 'activity-sample-return',
    title: '近地小行星取样返回',
    text: '接近目标小行星，执行近距离探测、采样封装与返回准备。',
    requirementIds: ['REQ-TW2-001'],
    performedBy: ['sampling-return', 'gnc'],
  },
  {
    id: 'activity-cruise-safety',
    title: '深空巡航安全维持',
    text: '在深空巡航阶段维持姿态、能源和热控安全边界。',
    requirementIds: ['REQ-TW2-002'],
    performedBy: ['spacecraft-platform', 'power-thermal', 'gnc'],
  },
  {
    id: 'activity-telemetry-downlink',
    title: '遥测与科学数据下传',
    text: '通过测控通信链路完成深空测控、数据下传和遥测接收。',
    requirementIds: ['REQ-TW2-003'],
    performedBy: ['ttc-communication'],
  },
  {
    id: 'activity-trace-coverage-check',
    title: '模型工件追溯覆盖校验',
    text: '检查需求到结构和行为视图的覆盖关系，并把缺口暴露为可操作校验结果。',
    requirementIds: ['REQ-TW2-004'],
    performedBy: ['spacecraft-platform', 'ttc-communication'],
  },
];

const fallbackRequirements: ConfirmedRequirement[] = [
  {
    id: 'REQ-TW2-001',
    title: '小行星采样返回任务',
    text: '探测器应支持近地小行星采样返回任务。',
    parentId: null,
    tracedTo: ['航天器平台', '采样返回分系统'],
  },
  {
    id: 'REQ-TW2-002',
    title: '深空巡航安全边界',
    text: '探测器应在深空巡航阶段维持姿态、能源和热控安全边界。',
    parentId: 'REQ-TW2-001',
    tracedTo: ['航天器平台', '电源与热控分系统', '制导导航与控制分系统'],
  },
  {
    id: 'REQ-TW2-003',
    title: '测控通信与数据下传',
    text: '探测器应通过测控通信链路下传工程遥测与科学数据。',
    parentId: 'REQ-TW2-001',
    tracedTo: ['测控通信分系统'],
  },
  {
    id: 'REQ-TW2-004',
    title: '模型工件追溯关系',
    text: '探测器应保留模型工件与需求、结构、行为视图之间的追溯关系。',
    parentId: 'REQ-TW2-001',
    tracedTo: ['航天器平台', '测控通信分系统'],
  },
];

const fallbackSubsystems: ConfirmedSubsystem[] = [
  { id: 'spacecraft-platform', name: '航天器平台', parentId: null },
  { id: 'sampling-return', name: '采样返回分系统', parentId: 'spacecraft-platform' },
  { id: 'ttc-communication', name: '测控通信分系统', parentId: 'spacecraft-platform' },
  { id: 'power-thermal', name: '电源与热控分系统', parentId: 'spacecraft-platform' },
  { id: 'gnc', name: '制导导航与控制分系统', parentId: 'spacecraft-platform' },
];

const fallbackInterfaces: ConfirmedInterface[] = [
  {
    id: 'connection-sample-transfer-to-platform',
    label: '样品转移接口',
    kind: 'sample',
    interfaceId: 'sample-transfer',
    sourceSubsystemId: 'sampling-return',
    sourcePortId: 'sample-transfer-out',
    sourcePortLabel: '样品转移与封装接口',
    targetSubsystemId: 'spacecraft-platform',
    targetPortId: 'sample-return-mechanical-interface',
    targetPortLabel: '样品转移接口',
    requirementIds: ['REQ-TW2-001'],
  },
  {
    id: 'connection-sample-telemetry-to-ttc',
    label: '采样遥测数据接口',
    kind: 'data',
    interfaceId: 'telemetry-data',
    sourceSubsystemId: 'sampling-return',
    sourcePortId: 'sample-telemetry-out',
    sourcePortLabel: '采样遥测数据接口',
    targetSubsystemId: 'ttc-communication',
    targetPortId: 'data-bus-in',
    targetPortLabel: '遥测数据接收接口',
    requirementIds: ['REQ-TW2-003'],
  },
  {
    id: 'connection-power-thermal-to-sampling',
    label: '供电与热控接口',
    kind: 'power',
    interfaceId: 'power-thermal',
    sourceSubsystemId: 'power-thermal',
    sourcePortId: 'power-thermal-service',
    sourcePortLabel: '供电与热控服务接口',
    targetSubsystemId: 'sampling-return',
    targetPortId: 'sample-power-thermal-in',
    targetPortLabel: '采样供电与热控接口',
    requirementIds: ['REQ-TW2-002'],
  },
  {
    id: 'connection-gnc-data-to-ttc',
    label: '姿态遥测数据接口',
    kind: 'control',
    interfaceId: 'telemetry-data',
    sourceSubsystemId: 'gnc',
    sourcePortId: 'attitude-control-data',
    sourcePortLabel: '姿态控制数据接口',
    targetSubsystemId: 'ttc-communication',
    targetPortId: 'telemetry-downlink',
    targetPortLabel: '测控通信下传接口',
    requirementIds: ['REQ-TW2-002', 'REQ-TW2-003'],
  },
];

const fallbackConstraints: ParameterConstraint[] = [
  {
    id: 'constraint-mass-budget',
    label: '质量预算约束',
    expression: 'spacecraft-dry-mass <= 1000 kg',
    relatedElementIds: ['spacecraft-platform', 'sampling-return'],
    requirementIds: ['REQ-TW2-001'],
  },
  {
    id: 'constraint-power-budget',
    label: '电源输出约束',
    expression: 'solar-array-output >= 2000 W',
    relatedElementIds: ['power-thermal', 'spacecraft-platform'],
    requirementIds: ['REQ-TW2-002'],
  },
];

const fallbackParameters: ConstraintParameter[] = [
  {
    id: 'spacecraft-dry-mass',
    label: '探测器干质量',
    unit: 'kg',
    unitSymbol: 'kg',
    relatedElementIds: ['spacecraft-platform', 'sampling-return'],
  },
  {
    id: 'solar-array-output',
    label: '太阳翼输出功率',
    unit: 'W',
    unitSymbol: 'W',
    relatedElementIds: ['power-thermal', 'spacecraft-platform'],
  },
];

const fallbackBindings: ParameterBinding[] = [
  {
    id: 'binding-mass-budget-dry-mass',
    kind: 'binding',
    constraintId: 'constraint-mass-budget',
    parameterId: 'spacecraft-dry-mass',
    label: '质量参数绑定',
    relatedElementIds: ['spacecraft-platform', 'sampling-return'],
  },
  {
    id: 'binding-power-budget-solar-array-output',
    kind: 'binding',
    constraintId: 'constraint-power-budget',
    parameterId: 'solar-array-output',
    label: '功率参数绑定',
    relatedElementIds: ['power-thermal', 'spacecraft-platform'],
  },
];

export const defaultTianwen2ConfirmedData: ConfirmedTianwen2Data = {
  projectId: 'tianwen-2',
  packageName: 'Tianwen2ConfirmedModel',
  mission: '天问二号任务面向小行星取样返回和主带彗星扩展探测。',
  requirements: fallbackRequirements,
  subsystems: fallbackSubsystems,
  activities: fallbackActivities,
  interfaces: fallbackInterfaces,
  constraints: fallbackConstraints,
  parameters: fallbackParameters,
  bindings: fallbackBindings,
};

export function extractTianwen2ConfirmedData(sourceText: string): ConfirmedTianwen2Data {
  const requirementById = new Map(fallbackRequirements.map((requirement) => [requirement.id, requirement]));
  const requirementPattern = /(REQ-TW2-\d{3})[：:](.+)/g;
  let match = requirementPattern.exec(sourceText);

  while (match) {
    const id = match[1];
    const text = match[2].trim();
    const fallback = requirementById.get(id);
    requirementById.set(id, {
      id,
      title: fallback?.title ?? text.replace(/[。；;].*$/, '').slice(0, 24),
      text,
      parentId: id === 'REQ-TW2-001' ? null : 'REQ-TW2-001',
      tracedTo: fallback?.tracedTo ?? inferTraces(text),
    });
    match = requirementPattern.exec(sourceText);
  }

  return {
    ...defaultTianwen2ConfirmedData,
    mission: inferMission(sourceText),
    requirements: Array.from(requirementById.values()).sort((left, right) => left.id.localeCompare(right.id)),
    subsystems: fallbackSubsystems,
    activities: fallbackActivities,
    interfaces: fallbackInterfaces,
    constraints: fallbackConstraints,
    parameters: fallbackParameters,
    bindings: fallbackBindings,
  };
}


export function validateViewModel(candidate: unknown): ViewModelValidationResult {
  const errors: ViewModelValidationError[] = [];
  const findings: ViewModelValidationFinding[] = [];

  const matrixViews: Array<{
    id: string;
    rows: Array<{ id: string; requirementId: string; path: string }>;
    cells: Array<{ rowId: string; requirementId: string; covered: boolean }>;
  }> = [];

  if (!isRecord(candidate)) {
    return {
      valid: false,
      errors: [{ code: 'schema', message: 'schema 根对象必须是 JSON 对象。', path: '$' }],
      findings,
    };
  }

  if (typeof candidate.schemaVersion !== 'string' || candidate.schemaVersion.trim() === '') {
    errors.push({ code: 'schema', message: 'schema 缺少必需字段 schemaVersion。', path: '$.schemaVersion' });
  }

  if (typeof candidate.projectId !== 'string' || candidate.projectId.trim() === '') {
    errors.push({ code: 'schema', message: 'schema 缺少必需字段 projectId。', path: '$.projectId' });
  }

  if (!Array.isArray(candidate.views)) {
    errors.push({ code: 'schema', message: 'schema 缺少必需数组 views。', path: '$.views' });
    return { valid: false, errors, findings };
  }
  const globalElementIds = new Set<string>();
  candidate.views.forEach((view) => {
    if (!isRecord(view) || !Array.isArray(view.nodes)) {
      return;
    }
    view.nodes.forEach((node) => {
      if (!isRecord(node)) {
        return;
      }
      const id = typeof node.id === 'string' ? node.id : '';
      const elementId = typeof node.elementId === 'string' ? node.elementId : '';
      if (id.trim() !== '') {
        globalElementIds.add(id);
      }
      if (elementId.trim() !== '') {
        globalElementIds.add(elementId);
      }
    });
  });


  candidate.views.forEach((view, viewIndex) => {
    if (!isRecord(view)) {
      errors.push({ code: 'schema', message: 'view 必须是对象。', path: `$.views[${viewIndex}]` });
      return;
    }

    const viewPath = `$.views[${viewIndex}]`;
    for (const key of ['id', 'title', 'kind']) {
      if (typeof view[key] !== 'string' || view[key].trim() === '') {
        errors.push({ code: 'schema', message: `schema 缺少 view.${key}。`, path: `${viewPath}.${key}` });
      }
    }

    if (!Array.isArray(view.nodes)) {
      errors.push({ code: 'schema', message: 'schema 缺少 view.nodes 数组。', path: `${viewPath}.nodes` });
      return;
    }

    if (!Array.isArray(view.edges)) {
      errors.push({ code: 'schema', message: 'schema 缺少 view.edges 数组。', path: `${viewPath}.edges` });
      return;
    }

    const nodeIds = new Set<string>();
    view.nodes.forEach((node, nodeIndex) => {
      if (!isRecord(node) || typeof node.id !== 'string' || node.id.trim() === '') {
        errors.push({ code: 'schema', message: 'schema 缺少 node.id。', path: `${viewPath}.nodes[${nodeIndex}].id` });
        return;
      }
      nodeIds.add(node.id);
    });

    view.edges.forEach((edge, edgeIndex) => {
      if (!isRecord(edge)) {
        errors.push({ code: 'schema', message: 'edge 必须是对象。', path: `${viewPath}.edges[${edgeIndex}]` });
        return;
      }

      const edgePath = `${viewPath}.edges[${edgeIndex}]`;
      for (const endpoint of ['source', 'target'] as const) {
        const endpointValue = edge[endpoint];
        if (typeof endpointValue !== 'string' || endpointValue.trim() === '') {
          errors.push({ code: 'schema', message: `schema 缺少 edge.${endpoint}。`, path: `${edgePath}.${endpoint}` });
        } else if (!nodeIds.has(endpointValue)) {
          errors.push({
            code: 'missing-reference',
            message: `引用不存在：${endpointValue} 未在 ${String(view.title ?? view.id ?? viewIndex)} 的节点中声明。`,
            path: `${edgePath}.${endpoint}`,
          });
        }
      }
    });

    if (view.kind === 'ibd') {
      validateIbdView(view, viewPath, nodeIds, errors);
    }

    if (view.kind === 'parameter-constraints') {
      validateParameterConstraintView(view, viewPath, errors, globalElementIds);
    }

    if (view.kind !== 'traceability-matrix') {
      return;
    }

    if (!Array.isArray(view.rows)) {
      errors.push({ code: 'schema', message: '追溯矩阵缺少 rows 数组。', path: `${viewPath}.rows` });
      return;
    }
    if (!Array.isArray(view.columns)) {
      errors.push({ code: 'schema', message: '追溯矩阵缺少 columns 数组。', path: `${viewPath}.columns` });
      return;
    }
    if (!Array.isArray(view.cells)) {
      errors.push({ code: 'schema', message: '追溯矩阵缺少 cells 数组。', path: `${viewPath}.cells` });
      return;
    }

    const rows = view.rows.flatMap((row, rowIndex) => {
      if (!isRecord(row) || typeof row.id !== 'string' || row.id.trim() === '') {
        errors.push({ code: 'schema', message: '追溯矩阵 row 缺少 id。', path: `${viewPath}.rows[${rowIndex}].id` });
        return [];
      }
      const requirementId = typeof row.requirementId === 'string' && row.requirementId.trim() !== '' ? row.requirementId : row.id;
      return [{ id: row.id, requirementId, path: `${viewPath}.rows[${rowIndex}]` }];
    });
    const rowIds = new Set(rows.flatMap((row) => [row.id, row.requirementId]));
    const columnIds = new Set<string>();

    view.columns.forEach((column, columnIndex) => {
      if (!isRecord(column) || typeof column.id !== 'string' || column.id.trim() === '') {
        errors.push({ code: 'schema', message: '追溯矩阵 column 缺少 id。', path: `${viewPath}.columns[${columnIndex}].id` });
        return;
      }
      columnIds.add(column.id);
    });

    const cells = view.cells.flatMap((cell, cellIndex) => {
      if (!isRecord(cell)) {
        errors.push({ code: 'schema', message: '追溯矩阵 cell 必须是对象。', path: `${viewPath}.cells[${cellIndex}]` });
        return [];
      }
      const rowId = typeof cell.rowId === 'string' ? cell.rowId : typeof cell.requirementId === 'string' ? cell.requirementId : '';
      const requirementId = typeof cell.requirementId === 'string' ? cell.requirementId : rowId;
      const columnId = typeof cell.columnId === 'string' ? cell.columnId : '';
      if (!rowIds.has(rowId)) {
        errors.push({ code: 'missing-reference', message: `追溯矩阵引用不存在的需求行：${rowId}。`, path: `${viewPath}.cells[${cellIndex}].rowId` });
      }
      if (!columnIds.has(columnId)) {
        errors.push({ code: 'missing-reference', message: `追溯矩阵引用不存在的列：${columnId}。`, path: `${viewPath}.cells[${cellIndex}].columnId` });
      }
      return [{ rowId, requirementId, covered: cell.covered === true }];
    });

    matrixViews.push({ id: String(view.id ?? `view-${viewIndex}`), rows, cells });
  });

  for (const matrixView of matrixViews) {
    for (const row of matrixView.rows) {
      const hasCoverage = matrixView.cells.some(
        (cell) => (cell.rowId === row.id || cell.requirementId === row.requirementId) && cell.covered,
      );
      if (!hasCoverage) {
        findings.push({
          code: 'uncovered-requirement',
          severity: 'warning',
          message: `需求 ${row.requirementId} 未覆盖任何结构或行为元素。`,
          path: row.path,
          elementId: row.requirementId,
          requirementId: row.requirementId,
          viewId: matrixView.id,
        });
      }
    }
  }

  return { valid: errors.length === 0 && findings.length === 0, errors, findings };
}

function validateIbdView(
  view: Record<string, unknown>,
  viewPath: string,
  nodeIds: Set<string>,
  errors: ViewModelValidationError[],
) {
  const readString = (record: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() !== '') {
        return value;
      }
    }
    return '';
  };

  const portByScopedId = new Map<string, { interfaceId: string; path: string }>();
  const registerPort = (port: unknown, fallbackOwnerId: string, path: string) => {
    if (!isRecord(port)) {
      errors.push({ code: 'schema', message: 'IBD 端口必须是对象。', path });
      return;
    }

    const portId = readString(port, ['id', 'portId']);
    const ownerId = readString(port, ['ownerId', 'nodeId', 'partId', 'componentId', 'elementId']) || fallbackOwnerId;
    const interfaceId = readString(port, ['interfaceId', 'interface']);

    if (portId === '') {
      errors.push({ code: 'schema', message: 'IBD 端口缺少稳定 id。', path: `${path}.id` });
    }
    if (ownerId === '') {
      errors.push({ code: 'schema', message: 'IBD 端口缺少所属部件 ownerId。', path: `${path}.ownerId` });
    } else if (!nodeIds.has(ownerId)) {
      errors.push({ code: 'missing-reference', message: `IBD 端口引用不存在的部件：${ownerId}。`, path: `${path}.ownerId` });
    }
    if (interfaceId === '') {
      errors.push({ code: 'invalid-connection', message: `IBD 端口 ${portId || path} 接口不完整：缺少 interfaceId。`, path: `${path}.interfaceId` });
    }

    if (portId !== '' && ownerId !== '') {
      portByScopedId.set(`${ownerId}:${portId}`, { interfaceId, path });
    }
  };

  if (Array.isArray(view.nodes)) {
    view.nodes.forEach((node, nodeIndex) => {
      if (!isRecord(node) || typeof node.id !== 'string') {
        return;
      }
      if (Array.isArray(node.ports)) {
        node.ports.forEach((port, portIndex) => registerPort(port, node.id as string, `${viewPath}.nodes[${nodeIndex}].ports[${portIndex}]`));
      }
    });
  }

  if (view.ports !== undefined) {
    if (!Array.isArray(view.ports)) {
      errors.push({ code: 'schema', message: 'IBD view.ports 必须是数组。', path: `${viewPath}.ports` });
    } else {
      view.ports.forEach((port, portIndex) => registerPort(port, '', `${viewPath}.ports[${portIndex}]`));
    }
  }

  const edgeConnections = Array.isArray(view.edges)
    ? view.edges.flatMap((edge, edgeIndex) => {
        if (!isRecord(edge)) {
          return [];
        }
        const kind = readString(edge, ['kind']);
        return /connection|connector|连接/.test(kind) ? [{ connection: edge, path: `${viewPath}.edges[${edgeIndex}]` }] : [];
      })
    : [];
  const explicitConnections = Array.isArray(view.connections)
    ? view.connections.flatMap((connection, connectionIndex) =>
        isRecord(connection) ? [{ connection, path: `${viewPath}.connections[${connectionIndex}]` }] : [],
      )
    : [];

  if (view.connections !== undefined && !Array.isArray(view.connections)) {
    errors.push({ code: 'schema', message: 'IBD view.connections 必须是数组。', path: `${viewPath}.connections` });
  }

  if (edgeConnections.length > 0 && explicitConnections.length > 0) {
    const edgesById = new Map(edgeConnections.map((entry) => [readString(entry.connection, ['id']) || entry.path, entry]));
    const connectionIds = new Set<string>();
    for (const explicitConnection of explicitConnections) {
      const id = readString(explicitConnection.connection, ['id']) || explicitConnection.path;
      connectionIds.add(id);
      const edgeConnection = edgesById.get(id);
      if (!edgeConnection) {
        errors.push({
          code: 'invalid-connection',
          message: `IBD edges/connections 同步错误：connections 中的 ${id} 没有对应 edge。`,
          path: explicitConnection.path,
        });
        continue;
      }

      for (const field of ['source', 'target', 'sourcePort', 'targetPort'] as const) {
        if (readString(edgeConnection.connection, [field]) !== readString(explicitConnection.connection, [field])) {
          errors.push({
            code: 'invalid-connection',
            message: `IBD edges/connections 同步错误：${id} 的 ${field} 不一致。`,
            path: `${explicitConnection.path}.${field}`,
          });
        }
      }
    }

    for (const edgeConnection of edgeConnections) {
      const id = readString(edgeConnection.connection, ['id']) || edgeConnection.path;
      if (!connectionIds.has(id)) {
        errors.push({
          code: 'invalid-connection',
          message: `IBD edges/connections 同步错误：edges 中的 ${id} 没有对应 connection。`,
          path: edgeConnection.path,
        });
      }
    }
  }

  for (const { connection, path } of [...edgeConnections, ...explicitConnections]) {
    const id = readString(connection, ['id']) || path;
    const source = readString(connection, ['source']);
    const target = readString(connection, ['target']);
    const sourcePort = readString(connection, ['sourcePort', 'sourcePortId']);
    const targetPort = readString(connection, ['targetPort', 'targetPortId']);

    if (source === '' || !nodeIds.has(source)) {
      errors.push({ code: 'missing-reference', message: `IBD 连接 ${id} 引用不存在的 source 部件：${source}。`, path: `${path}.source` });
    }
    if (target === '' || !nodeIds.has(target)) {
      errors.push({ code: 'missing-reference', message: `IBD 连接 ${id} 引用不存在的 target 部件：${target}。`, path: `${path}.target` });
    }
    if (sourcePort === '') {
      errors.push({ code: 'missing-endpoint', message: `IBD 连接 ${id} 缺少 sourcePort 端口端点。`, path: `${path}.sourcePort` });
    }
    if (targetPort === '') {
      errors.push({ code: 'missing-endpoint', message: `IBD 连接 ${id} 缺少 targetPort 端口端点。`, path: `${path}.targetPort` });
    }

    const sourcePortRecord = sourcePort === '' ? undefined : portByScopedId.get(`${source}:${sourcePort}`);
    const targetPortRecord = targetPort === '' ? undefined : portByScopedId.get(`${target}:${targetPort}`);
    if (sourcePort !== '' && !sourcePortRecord) {
      errors.push({ code: 'missing-reference', message: `IBD 连接 ${id} 引用不存在的 source 端口：${source}.${sourcePort}。`, path: `${path}.sourcePort` });
    }
    if (targetPort !== '' && !targetPortRecord) {
      errors.push({ code: 'missing-reference', message: `IBD 连接 ${id} 引用不存在的 target 端口：${target}.${targetPort}。`, path: `${path}.targetPort` });
    }
    if (!sourcePortRecord || !targetPortRecord) {
      continue;
    }
    if (sourcePortRecord.interfaceId === '' || targetPortRecord.interfaceId === '') {
      errors.push({ code: 'invalid-connection', message: `IBD 连接 ${id} 接口不完整：端口缺少 interfaceId。`, path });
      continue;
    }
    if (sourcePortRecord.interfaceId !== targetPortRecord.interfaceId) {
      errors.push({
        code: 'invalid-connection',
        message: `IBD 连接 ${id} 接口不匹配：${sourcePortRecord.interfaceId} -> ${targetPortRecord.interfaceId}。`,
        path,
      });
    }
  }
}

function validateParameterConstraintView(
  view: Record<string, unknown>,
  viewPath: string,
  errors: ViewModelValidationError[],
  globalElementIds: Set<string>,
) {
  const readString = (record: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() !== '') {
        return value;
      }
    }
    return '';
  };
  const validateRelatedElementIds = (record: Record<string, unknown>, path: string) => {
    const relatedElementIds = record.relatedElementIds;
    if (relatedElementIds === undefined) {
      return;
    }
    if (!Array.isArray(relatedElementIds)) {
      errors.push({ code: 'schema', message: '参数约束相关模型元素 relatedElementIds 必须是数组。', path: `${path}.relatedElementIds` });
      return;
    }
    relatedElementIds.forEach((elementId, elementIndex) => {
      if (typeof elementId !== 'string' || elementId.trim() === '') {
        errors.push({ code: 'schema', message: '参数约束相关模型元素 id 必须是非空字符串。', path: `${path}.relatedElementIds[${elementIndex}]` });
        return;
      }
      if (!globalElementIds.has(elementId)) {
        errors.push({ code: 'missing-reference', message: `参数约束相关模型元素引用不存在：${elementId}。`, path: `${path}.relatedElementIds[${elementIndex}]` });
      }
    });
  };


  if (!Array.isArray(view.constraints)) {
    errors.push({ code: 'schema', message: '参数约束视图缺少 constraints 数组。', path: `${viewPath}.constraints` });
    return;
  }
  if (!Array.isArray(view.parameters)) {
    errors.push({ code: 'missing-parameter', message: '参数约束视图参数缺失：缺少 parameters 数组。', path: `${viewPath}.parameters` });
    return;
  }
  if (!Array.isArray(view.bindings)) {
    errors.push({ code: 'missing-binding', message: '参数约束视图绑定缺失：缺少 bindings 数组。', path: `${viewPath}.bindings` });
    return;
  }

  const constraintIds = new Set<string>();
  view.constraints.forEach((constraint, constraintIndex) => {
    const path = `${viewPath}.constraints[${constraintIndex}]`;
    if (!isRecord(constraint)) {
      errors.push({ code: 'schema', message: '参数约束必须是对象。', path });
      return;
    }

    const constraintId = readString(constraint, ['id', 'constraintId']);
    if (constraintId === '') {
      errors.push({ code: 'schema', message: '参数约束缺少稳定 id。', path: `${path}.id` });
      return;
    }
    constraintIds.add(constraintId);
    validateRelatedElementIds(constraint, path);
  });

  const parameterIds = new Set<string>();
  view.parameters.forEach((parameter, parameterIndex) => {
    const path = `${viewPath}.parameters[${parameterIndex}]`;
    if (!isRecord(parameter)) {
      errors.push({ code: 'schema', message: '参数必须是对象。', path });
      return;
    }

    const parameterId = readString(parameter, ['id', 'parameterId']);
    if (parameterId === '') {
      errors.push({ code: 'missing-parameter', message: '参数约束视图参数缺失：参数缺少稳定 id。', path: `${path}.id` });
      return;
    }
    parameterIds.add(parameterId);

    if (readString(parameter, ['unit', 'unitSymbol', 'unitId']) === '') {
      errors.push({ code: 'missing-unit', message: `参数 ${parameterId} 单位缺失。`, path: `${path}.unit` });
    }
    validateRelatedElementIds(parameter, path);
  });

  if (view.parameters.length === 0) {
    errors.push({ code: 'missing-parameter', message: '参数约束视图参数缺失：至少需要一个参数。', path: `${viewPath}.parameters` });
  }
  if (view.bindings.length === 0) {
    errors.push({ code: 'missing-binding', message: '参数约束视图绑定缺失：至少需要一个约束到参数的绑定。', path: `${viewPath}.bindings` });
  }

  const boundConstraintIds = new Set<string>();

  view.bindings.forEach((binding, bindingIndex) => {
    const path = `${viewPath}.bindings[${bindingIndex}]`;
    if (!isRecord(binding)) {
      errors.push({ code: 'schema', message: '参数绑定必须是对象。', path });
      return;
    }

    const constraintId = readString(binding, ['constraintId', 'source']);
    const parameterId = readString(binding, ['parameterId', 'target']);
    if (constraintId === '' || !constraintIds.has(constraintId)) {
      errors.push({ code: 'missing-reference', message: `参数绑定引用不存在的约束：${constraintId}。`, path: `${path}.constraintId` });
    }
    if (constraintId !== '' && constraintIds.has(constraintId)) {
      boundConstraintIds.add(constraintId);
    }
    if (parameterId === '' || !parameterIds.has(parameterId)) {
      errors.push({ code: 'missing-parameter', message: `参数绑定参数缺失：${parameterId} 未在 parameters 中声明。`, path: `${path}.parameterId` });
    }
    validateRelatedElementIds(binding, path);
  });

  view.constraints.forEach((constraint, constraintIndex) => {
    if (!isRecord(constraint)) {
      return;
    }
    const constraintId = readString(constraint, ['id', 'constraintId']);
    if (constraintId !== '' && !boundConstraintIds.has(constraintId)) {
      errors.push({
        code: 'missing-binding',
        message: `参数约束 ${constraintId} 绑定缺失：未绑定任何参数。`,
        path: `${viewPath}.constraints[${constraintIndex}]`,
      });
    }
  });
}


function inferMission(sourceText: string): string {
  const missionSection = sourceText.match(/##\s*使命目标\s*(?<body>[\s\S]*?)(?:\n##\s+|$)/);
  const missionLines = missionSection?.groups?.body
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-#\s]+/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('REQ-') && /小行星|彗星|采样返回|深空/.test(line));

  if (missionLines && missionLines.length > 0) {
    return missionLines.join('；');
  }

  const missionLine = sourceText
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-#\s]+/, '').trim())
    .find((line) =>
      /小行星|彗星|采样返回|深空/.test(line) &&
      !line.startsWith('REQ-') &&
      !line.includes('任务与需求材料') &&
      !line.includes('样例项目用于'),
    );

  return missionLine || defaultTianwen2ConfirmedData.mission;
}

function inferTraces(text: string): string[] {
  const traces = fallbackSubsystems
    .filter((subsystem) => text.includes(subsystem.name.replace('分系统', '')) || text.includes(subsystem.name))
    .map((subsystem) => subsystem.name);

  return traces.length > 0 ? traces : ['航天器平台'];
}

function toSysmlIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
