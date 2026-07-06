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

export interface ConfirmedTianwen2Data {
  projectId: string;
  packageName: string;
  mission: string;
  requirements: ConfirmedRequirement[];
  subsystems: ConfirmedSubsystem[];
}

export interface ViewNode {
  id: string;
  kind: 'mission' | 'requirement' | 'subsystem' | 'system';
  label: string;
  text?: string;
  position: {
    x: number;
    y: number;
  };
}

export interface ViewEdge {
  id: string;
  kind: 'hierarchy' | 'trace' | 'composition';
  source: string;
  target: string;
  label?: string;
}

export interface GeneratedView {
  id: string;
  title: string;
  kind: 'requirements' | 'bdd';
  layout: 'auto';
  layoutEngine: 'deterministic-layered-layout';
  nodes: ViewNode[];
  edges: ViewEdge[];
}

export interface GeneratedViewModel {
  schemaVersion: string;
  projectId: string;
  source: 'confirmed-import-data';
  generatedFrom: string;
  views: GeneratedView[];
  validation: {
    status: 'passed' | 'failed';
    checkedRules: string[];
  };
}

export interface ModelGenerationResult {
  sysmlText: string;
  viewModel: GeneratedViewModel;
  validation: ViewModelValidationResult;
}

export interface ViewModelValidationError {
  code: 'schema' | 'missing-reference';
  message: string;
  path: string;
}

export interface ViewModelValidationResult {
  valid: boolean;
  errors: ViewModelValidationError[];
}

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

export const defaultTianwen2ConfirmedData: ConfirmedTianwen2Data = {
  projectId: 'tianwen-2',
  packageName: 'Tianwen2ConfirmedModel',
  mission: '天问二号任务面向小行星取样返回和主带彗星扩展探测。',
  requirements: fallbackRequirements,
  subsystems: fallbackSubsystems,
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
  };
}

export function generateTianwen2ModelArtifacts(
  confirmedData: ConfirmedTianwen2Data,
): ModelGenerationResult {
  const viewModel = buildViewModel(confirmedData);
  const validation = validateViewModel(viewModel);

  return {
    sysmlText: buildSysmlText(confirmedData),
    viewModel: {
      ...viewModel,
      validation: {
        ...viewModel.validation,
        status: validation.valid ? 'passed' : 'failed',
      },
    },
    validation,
  };
}

export function validateViewModel(candidate: unknown): ViewModelValidationResult {
  const errors: ViewModelValidationError[] = [];

  if (!isRecord(candidate)) {
    return {
      valid: false,
      errors: [{ code: 'schema', message: 'schema 根对象必须是 JSON 对象。', path: '$' }],
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
    return { valid: errors.length === 0, errors };
  }

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
  });

  return { valid: errors.length === 0, errors };
}

function buildViewModel(confirmedData: ConfirmedTianwen2Data): GeneratedViewModel {
  const subsystemByName = new Map(confirmedData.subsystems.map((subsystem) => [subsystem.name, subsystem]));
  const tracedSubsystems = new Map<string, ConfirmedSubsystem>();

  for (const requirement of confirmedData.requirements) {
    for (const subsystemName of requirement.tracedTo) {
      const subsystem = subsystemByName.get(subsystemName);
      if (subsystem) {
        tracedSubsystems.set(subsystem.id, subsystem);
      }
    }
  }

  const requirementNodes: ViewNode[] = confirmedData.requirements.map((requirement, index) => ({
    id: requirement.id,
    kind: 'requirement',
    label: requirement.title,
    text: requirement.text,
    position: { x: requirement.parentId === null ? 40 : 320, y: 40 + index * 118 },
  }));

  const tracedSubsystemNodes: ViewNode[] = Array.from(tracedSubsystems.values()).map((subsystem, index) => ({
    id: subsystem.id,
    kind: 'subsystem',
    label: subsystem.name,
    position: { x: 680, y: 40 + index * 118 },
  }));

  const hierarchyEdges: ViewEdge[] = confirmedData.requirements
    .filter((requirement) => requirement.parentId)
    .map((requirement) => ({
      id: `hierarchy-${requirement.parentId}-${requirement.id}`,
      kind: 'hierarchy',
      source: requirement.parentId as string,
      target: requirement.id,
      label: '需求层级',
    }));

  const traceEdges: ViewEdge[] = confirmedData.requirements.flatMap((requirement) =>
    requirement.tracedTo.flatMap((subsystemName) => {
      const subsystem = subsystemByName.get(subsystemName);
      if (!subsystem) {
        return [];
      }

      return [
        {
          id: `trace-${requirement.id}-${subsystem.id}`,
          kind: 'trace' as const,
          source: requirement.id,
          target: subsystem.id,
          label: '追溯满足',
        },
      ];
    }),
  );

  const bddNodes: ViewNode[] = confirmedData.subsystems.map((subsystem, index) => ({
    id: subsystem.id,
    kind: subsystem.parentId === null ? 'system' : 'subsystem',
    label: subsystem.name,
    position: subsystem.parentId === null ? { x: 320, y: 40 } : { x: 80 + (index - 1) * 230, y: 220 },
  }));

  const compositionEdges: ViewEdge[] = confirmedData.subsystems
    .filter((subsystem) => subsystem.parentId)
    .map((subsystem) => ({
      id: `composition-${subsystem.parentId}-${subsystem.id}`,
      kind: 'composition',
      source: subsystem.parentId as string,
      target: subsystem.id,
      label: '组成',
    }));

  return {
    schemaVersion: '0.2.0',
    projectId: confirmedData.projectId,
    source: 'confirmed-import-data',
    generatedFrom: confirmedData.packageName,
    views: [
      {
        id: 'requirements-view',
        title: '需求视图',
        kind: 'requirements',
        layout: 'auto',
        layoutEngine: 'deterministic-layered-layout',
        nodes: [...requirementNodes, ...tracedSubsystemNodes],
        edges: [...hierarchyEdges, ...traceEdges],
      },
      {
        id: 'bdd-structure-view',
        title: 'BDD 结构视图',
        kind: 'bdd',
        layout: 'auto',
        layoutEngine: 'deterministic-layered-layout',
        nodes: bddNodes,
        edges: compositionEdges,
      },
    ],
    validation: {
      status: 'passed',
      checkedRules: ['schema', 'missing-reference'],
    },
  };
}

function buildSysmlText(confirmedData: ConfirmedTianwen2Data): string {
  const subsystemByName = new Map(confirmedData.subsystems.map((subsystem) => [subsystem.name, subsystem]));
  const lines = [
    `package ${confirmedData.packageName} {`,
    '  doc /*',
    `   * ${confirmedData.mission}`,
    '   * 由材料导入与确认向导生成，用于后续图形视图渲染。',
    '   */',
    '',
  ];

  for (const requirement of confirmedData.requirements) {
    lines.push(`  requirement def ${toSysmlIdentifier(requirement.id)} {`);
    lines.push(`    doc /* ${requirement.id}：${requirement.title}。${requirement.text} */`);
    if (requirement.parentId) {
      lines.push(`    doc /* derive ${requirement.parentId}，形成需求层级。 */`);
    }
    lines.push('  }');
    lines.push('');
  }

  for (const subsystem of confirmedData.subsystems) {
    lines.push(`  part def ${toSysmlIdentifier(subsystem.id)} {`);
    lines.push(`    doc /* ${subsystem.name}。 */`);
    if (subsystem.parentId) {
      lines.push(`    doc /* composition parent ${subsystem.parentId}。 */`);
    }
    lines.push('  }');
    lines.push('');
  }

  for (const requirement of confirmedData.requirements) {
    for (const subsystemName of requirement.tracedTo) {
      const subsystem = subsystemByName.get(subsystemName);
      if (!subsystem) {
        continue;
      }

      lines.push(`  satisfy ${toSysmlIdentifier(`${requirement.id}-${subsystem.id}`)} {`);
      lines.push(`    subject ${toSysmlIdentifier(subsystem.id)};`);
      lines.push(`    requirement ${toSysmlIdentifier(requirement.id)};`);
      lines.push(`    doc /* ${requirement.id} 追溯到 ${subsystem.name}，形成满足关系。 */`);
      lines.push('  }');
      lines.push('');
    }
  }

  lines.push('}');
  return lines.join('\n');
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
