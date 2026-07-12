import { defaultTianwen2ConfirmedData, extractTianwen2ConfirmedData, generateTianwen2ModelArtifacts, validateViewModel } from '../src/domain/modelGeneration';

const confirmedTianwen2Data = {
  ...defaultTianwen2ConfirmedData,
  projectId: 'tianwen-2',
  packageName: 'Tianwen2ConfirmedModel',
  mission: '天问二号任务面向小行星取样返回和主带彗星探测。',
  requirements: [
    {
      id: 'REQ-TW2-001',
      title: '小行星近距离探测与取样返回',
      text: '任务应支持对目标小行星开展近距离探测并完成取样返回。',
      parentId: null,
      tracedTo: ['航天器平台', '采样返回分系统'],
    },
    {
      id: 'REQ-TW2-002',
      title: '采样封装与返回转移',
      text: '采样返回分系统应完成样品采集、封装、转移和返回舱交付。',
      parentId: 'REQ-TW2-001',
      tracedTo: ['采样返回分系统'],
    },
    {
      id: 'REQ-TW2-003',
      title: '能源与热控保障',
      text: '电源与热控分系统应在深空飞行和近距离探测阶段提供能源与热环境保障。',
      parentId: 'REQ-TW2-001',
      tracedTo: ['电源与热控分系统'],
    },
    {
      id: 'REQ-TW2-004',
      title: '深空测控通信',
      text: '探测器应通过测控通信分系统完成深空测控、数据下传和遥测接收。',
      parentId: 'REQ-TW2-001',
      tracedTo: ['测控通信分系统'],
    },
  ],
  subsystems: [
    { id: 'spacecraft-platform', name: '航天器平台', parentId: null },
    { id: 'sampling-return', name: '采样返回分系统', parentId: 'spacecraft-platform' },
    { id: 'ttc-communication', name: '测控通信分系统', parentId: 'spacecraft-platform' },
    { id: 'power-thermal', name: '电源与热控分系统', parentId: 'spacecraft-platform' },
    { id: 'gnc', name: '制导导航与控制分系统', parentId: 'spacecraft-platform' },
  ],
};
type IssueFiveViewNode = {
  id: string;
  kind: string;
  label: string;
  text?: string;
  elementId?: string;
};

type IssueFiveViewEdge = {
  id: string;
  kind: string;
  source: string;
  target: string;
  label?: string;
};

type IssueFiveMatrixRow = {
  id: string;
  requirementId?: string;
  label?: string;
};

type IssueFiveMatrixColumn = {
  id: string;
  elementId?: string;
  kind: string;
  label: string;
};

type IssueFiveMatrixCell = {
  rowId?: string;
  requirementId?: string;
  columnId: string;
  covered?: boolean;
  status?: string;
};

type IssueFiveView = {
  id: string;
  title: string;
  kind: string;
  nodes: IssueFiveViewNode[];
  edges: IssueFiveViewEdge[];
  rows?: IssueFiveMatrixRow[];
  columns?: IssueFiveMatrixColumn[];
  cells?: IssueFiveMatrixCell[];
};

type IssueFiveValidationFinding = {
  code: string;
  message?: string;
  elementId?: string;
  requirementId?: string;
  target?: string;
  path?: string;
};

type IssueFiveValidationResult = {
  valid: boolean;
  errors: Array<{ code: string; message: string; path: string }>;
  findings?: IssueFiveValidationFinding[];
};

type IssueSixPort = Record<string, unknown> & {
  id?: unknown;
  label?: unknown;
  name?: unknown;
  kind?: unknown;
  ownerId?: unknown;
  nodeId?: unknown;
  partId?: unknown;
  componentId?: unknown;
  elementId?: unknown;
  interface?: unknown;
  interfaceId?: unknown;
};

type IssueSixEndpoint = Record<string, unknown> & {
  nodeId?: unknown;
  partId?: unknown;
  componentId?: unknown;
  portId?: unknown;
};

type IssueSixConnection = Record<string, unknown> & {
  id?: unknown;
  kind?: unknown;
  label?: unknown;
  source?: unknown;
  target?: unknown;
  sourcePort?: unknown;
  targetPort?: unknown;
  sourcePortId?: unknown;
  targetPortId?: unknown;
  sourceEndpoint?: unknown;
  targetEndpoint?: unknown;
  endpoints?: unknown;
};

type IssueSixViewNode = IssueFiveViewNode & {
  ports?: IssueSixPort[];
};

type IssueSixIbdView = Omit<IssueFiveView, 'nodes' | 'edges'> & {
  nodes: IssueSixViewNode[];
  edges?: IssueSixConnection[];
  connections?: IssueSixConnection[];
  ports?: IssueSixPort[];
};

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function textOf(...values: unknown[]) {
  return values.filter((value): value is string => typeof value === 'string').join(' ');
}


function endpointPortId(endpoint: unknown) {
  if (endpoint === null || typeof endpoint !== 'object') return '';
  return stringValue((endpoint as IssueSixEndpoint).portId);
}

function connectionPortIds(connection: IssueSixConnection) {
  const endpoints = Array.isArray(connection.endpoints) ? connection.endpoints : [];

  return [
    stringValue(connection.sourcePort),
    stringValue(connection.targetPort),
    stringValue(connection.sourcePortId),
    stringValue(connection.targetPortId),
    endpointPortId(connection.sourceEndpoint),
    endpointPortId(connection.targetEndpoint),
    endpointPortId(connection.source),
    endpointPortId(connection.target),
    ...endpoints.map(endpointPortId),
  ].filter(Boolean);
}


function extractSysmlDefinitionBlock(sysmlText: string, definitionKind: string, identifier: string) {
  const pattern = new RegExp(`\\b${definitionKind}\\s+def\\s+${identifier}\\s*\\{(?<body>[\\s\\S]*?)\\n\\s*\\}`, 'i');
  return pattern.exec(sysmlText)?.groups?.body ?? '';
}





describe('天问二号确认数据领域模型生成契约', () => {
  it('从内置材料使命目标抽取真实候选使命而不是 Markdown 标题', () => {
    const confirmedData = extractTianwen2ConfirmedData([
      '# 天问二号任务与需求材料',
      '',
      '天问二号探测器样例项目用于 MBSE 建模工作台的内置建模输入。',
      '',
      '## 使命目标',
      '',
      '- 对近地小行星开展采样返回任务，形成可追溯的任务需求、系统结构和关键活动模型。',
      '- 在主带彗星扩展探测阶段验证深空自主运行、能源管理和测控通信能力。',
      '',
      '## 候选需求',
      '- REQ-TW2-001：探测器应支持近地小行星采样返回任务。',
    ].join('\n'));

    expect(confirmedData.mission, '候选使命应来自使命目标列表，而不是材料标题或说明文字').toContain(
      '对近地小行星开展采样返回任务',
    );
    expect(confirmedData.mission).toContain('主带彗星扩展探测阶段');
    expect(confirmedData.mission).not.toBe('天问二号任务与需求材料');
  });

  it('从确认数据生成 SysML v2 文本、JSON 视图模型、需求视图和 BDD', () => {
    const artifacts = generateTianwen2ModelArtifacts(confirmedTianwen2Data);

    expect(artifacts.sysmlText, 'SysML v2 文本应使用稳定包名承载确认后的领域模型').toContain(
      'package Tianwen2ConfirmedModel',
    );
    expect(artifacts.sysmlText, 'SysML v2 文本应生成真实需求定义，而不是只展示 UI 文案').toContain(
      'requirement def',
    );
    expect(artifacts.sysmlText, 'SysML v2 文本应生成真实部件定义，供 BDD 结构视图引用').toContain(
      'part def',
    );
    expect(artifacts.sysmlText).toContain('REQ-TW2-001');
    expect(artifacts.sysmlText).toContain('REQ-TW2-004');
    expect(artifacts.sysmlText).toContain('测控通信分系统');
    expect(
      artifacts.sysmlText,
      'SysML v2 文本应保留需求到分系统的满足或追溯关系',
    ).toMatch(/satisfy|trace|refine|derive|满足|追溯/i);

    expect(artifacts.viewModel.schemaVersion, 'JSON 视图模型应声明 schemaVersion，供校验器选择规则').toEqual(
      expect.any(String),
    );
    expect(artifacts.viewModel.projectId, 'JSON 视图模型应绑定确认数据对应的项目 ID').toBe(
      'tianwen-2',
    );

    const requirementView = artifacts.viewModel.views.find((view) => view.kind === 'requirements');
    const bddView = artifacts.viewModel.views.find((view) => view.kind === 'bdd');

    expect(requirementView, '应生成可渲染的需求视图').toBeDefined();
    expect(bddView, '应生成可渲染的 BDD 结构视图').toBeDefined();
    expect(requirementView?.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['REQ-TW2-001', 'REQ-TW2-002', 'REQ-TW2-003', 'REQ-TW2-004']),
    );
    expect(
      requirementView?.edges.map((edge) => edge.kind),
      '需求视图应包含需求层级或追溯边，证明不是孤立卡片列表',
    ).toEqual(expect.arrayContaining(['hierarchy', 'trace']));
    expect(bddView?.nodes.map((node) => node.label)).toEqual(
      expect.arrayContaining([
        '航天器平台',
        '采样返回分系统',
        '测控通信分系统',
        '电源与热控分系统',
        '制导导航与控制分系统',
      ]),
    );
    expect(bddView?.edges.some((edge) => edge.source === 'spacecraft-platform')).toBe(true);

    for (const view of artifacts.viewModel.views) {
      expect(
        view.layout === 'auto' || view.nodes.every((node) => typeof node.position?.x === 'number' && typeof node.position?.y === 'number'),
        `${view.title} 应带自动布局标记或节点坐标，证明输出是可渲染模型`,
      ).toBe(true);
    }

    const validation = validateViewModel(artifacts.viewModel);

    expect(validation.valid, '领域生成出的有效 JSON 视图模型应通过校验').toBe(true);
    expect(validation.errors, '有效 JSON 视图模型不应产生 schema 或引用错误').toEqual([]);
  });

  it('从确认数据生成活动图视图并用活动流连接已声明行为节点', () => {
    const artifacts = generateTianwen2ModelArtifacts(confirmedTianwen2Data);
    const views = artifacts.viewModel.views as unknown as IssueFiveView[];

    const activityView = views.find((view) => view.kind === 'activity');

    expect(activityView, 'issue #5 要求 JSON 视图模型提供 kind=activity 的活动图视图，而不是只停留在需求视图和 BDD').toBeDefined();

    const activityNodes = activityView?.nodes.filter((node) => /activity|action|behavior/.test(node.kind)) ?? [];
    const activityText = activityNodes.map((node) => `${node.id} ${node.label} ${node.text ?? ''}`).join('\n');

    expect(activityText, '活动图必须包含可由天问二号需求推导出的取样返回行为，支撑用户验收活动节点').toMatch(/取样|采样.*返回/);
    expect(activityText, '活动图必须表达深空巡航、能源热控或安全维持类行为，覆盖 REQ-TW2-003 的行为侧').toMatch(/深空.*(巡航|飞行|安全|维持|保障)|能源.*热控/);
    expect(activityText, '活动图必须表达数据下传或遥测接收行为，覆盖 REQ-TW2-004 的测控通信活动').toMatch(/数据下传|遥测/);

    const activityNodeIds = new Set(activityNodes.map((node) => node.id));
    const flowEdges = activityView?.edges.filter((edge) => edge.kind === 'flow') ?? [];
    const danglingFlowEdges = flowEdges.filter((edge) => !activityNodeIds.has(edge.source) || !activityNodeIds.has(edge.target));

    expect(flowEdges.length, '活动图的边必须包含 kind=flow，证明展示的是活动流而不是孤立行为卡片').toBeGreaterThan(0);
    expect(danglingFlowEdges, '每条活动流边都必须连接活动图中已声明的行为节点，避免 UI 渲染悬空边').toEqual([]);
  });

  it('从确认数据生成 IBD 视图并表达部件、端口和连接', () => {
    const artifacts = generateTianwen2ModelArtifacts(confirmedTianwen2Data);
    const views = artifacts.viewModel.views as unknown as IssueSixIbdView[];
    const ibdView = views.find((view) => view.kind === 'ibd');

    expect(views.map((view) => view.kind), 'JSON 视图模型必须包含 kind=ibd，而不是只生成 requirements/bdd/activity/traceability-matrix').toContain('ibd');
    expect(ibdView, 'issue #6 要求从确认数据生成可渲染的 IBD 内部块图视图').toBeDefined();
    expect(`${ibdView?.id ?? ''} ${ibdView?.title ?? ''}`, 'IBD 视图的公开 id 或标题必须表达内部块图/IBD，便于用户识别视图入口').toMatch(/ibd|内部块图|internal block/i);

    const sysmlWithoutDocs = artifacts.sysmlText.replace(/\bdoc\s*\/\*[\s\S]*?\*\//gi, '');
    const interfaceDefinitions = sysmlWithoutDocs.match(/\binterface\s+def\s+[A-Za-z_][\w]*/g) ?? [];
    expect(interfaceDefinitions.length, 'SysML 文本必须声明可机读 interface def，不能只在 doc 注释里写 interface 名称').toBeGreaterThanOrEqual(3);
    expect(sysmlWithoutDocs, 'SysML 文本必须声明样品转移接口定义，供 IBD 端口用类型引用').toMatch(/\binterface\s+def\s+sample_transfer\b/i);

    const samplingReturnPartBlock = extractSysmlDefinitionBlock(sysmlWithoutDocs, 'part', 'sampling_return');
    expect(samplingReturnPartBlock.trim(), 'sampling_return part def 必须包含非注释的端口声明').not.toBe('');
    expect(
      samplingReturnPartBlock,
      'part 内必须用 port 声明把 sample_transfer_out 绑定到 sample_transfer 接口，而不是只靠说明文字',
    ).toMatch(/\bport\s+sample_transfer_out\s*:\s*sample_transfer\s*;/i);

    const sampleTransferConnectionBlock = extractSysmlDefinitionBlock(sysmlWithoutDocs, 'connection', 'connection_sample_transfer_to_platform');
    expect(sampleTransferConnectionBlock.trim(), 'connection_sample_transfer_to_platform 必须包含非注释的端点语义').not.toBe('');
    expect(
      sampleTransferConnectionBlock,
      'connection def 必须用 source/end source/from 等稳定字段表达源端点，不能只写在 doc 注释里',
    ).toMatch(/\b(?:end\s+source|source(?:Endpoint|Port)?|from)\b/i);
    expect(
      sampleTransferConnectionBlock,
      'connection def 必须用 target/end target/to 等稳定字段表达目标端点，不能只写在 doc 注释里',
    ).toMatch(/\b(?:end\s+target|target(?:Endpoint|Port)?|to)\b/i);
    expect(sampleTransferConnectionBlock, '样品转移连接块必须显式引用源端口 sample_transfer_out').toMatch(/\bsample_transfer_out\b/i);
    expect(sampleTransferConnectionBlock, '样品转移连接块必须显式引用目标端口 sample_return_mechanical_interface').toMatch(/\bsample_return_mechanical_interface\b/i);

    const ibdNodes = ibdView?.nodes ?? [];
    const nodeText = ibdNodes.map((node) => `${node.id} ${node.label} ${node.kind} ${node.text ?? ''}`).join('\n');
    expect(nodeText, 'IBD 必须展示航天器平台以及天问二号关键内部部件').toMatch(/航天器平台/);
    expect(nodeText).toMatch(/采样返回分系统|采样返回|sampling-return/);
    expect(nodeText).toMatch(/测控通信分系统|测控通信|ttc-communication/);
    expect(nodeText).toMatch(/电源与热控分系统|电源与热控|power-thermal/);
    expect(nodeText).toMatch(/制导导航与控制分系统|制导导航|gnc/);
    expect(
      ibdNodes.every((node) => /ibd|part|component|system|subsystem|部件|组件|分系统/.test(`${node.kind} ${node.label}`)),
      'IBD 节点必须带 part/component/system/subsystem 语义，不能复用无 IBD 语义的纯 BDD 节点',
    ).toBe(true);

    const ports = [
      ...(ibdView?.ports ?? []),
      ...ibdNodes.flatMap((node) => (node.ports ?? []).map((port) => ({ ...port, nodeId: port.nodeId ?? node.id }))),
    ];
    const portRows = ports.map((port) => ({
      id: stringValue(port.id),
      ownerId: stringValue(port.ownerId) || stringValue(port.nodeId) || stringValue(port.partId) || stringValue(port.componentId) || stringValue(port.elementId),
      text: textOf(port.id, port.label, port.name, port.kind, port.interface, port.interfaceId, port.ownerId, port.nodeId, port.partId, port.componentId, port.elementId),
    }));
    const portText = portRows.map((port) => `${port.id} ${port.ownerId} ${port.text}`).join('\n');

    expect(portRows.length, 'IBD 必须能定位端口数据，端口可在节点 ports 或视图 ports 字段中声明').toBeGreaterThan(0);
    expect(portRows.every((port) => port.id.length > 0 && port.ownerId.length > 0), '每个 IBD 端口必须有稳定端口 ID，并能定位到所属部件').toBe(true);
    expect(portText, '端口必须覆盖采样返回链路需要的样品转移或样品封装接口').toMatch(/样品.*(转移|封装)|采样.*(转移|封装)|sample.*(transfer|container|seal)/i);
    expect(portText, '端口必须覆盖测控通信链路需要的遥测或数据接口').toMatch(/遥测|数据|telemetry|data/i);
    expect(portText, '端口必须覆盖电源与热控链路需要的供电或热控接口').toMatch(/供电|电源|热控|power|thermal/i);

    const connections = [...(ibdView?.edges ?? []), ...(ibdView?.connections ?? [])].filter((connection) =>
      /connection|connector|连接/.test(stringValue(connection.kind)),
    );
    const connectionRows = connections.map((connection) => ({
      portIds: connectionPortIds(connection),
      text: textOf(connection.id, connection.kind, connection.label, connection.source, connection.target, connection.sourcePort, connection.targetPort, connection.sourcePortId, connection.targetPortId, ...connectionPortIds(connection)),
    }));
    const connectionText = connectionRows.map((connection) => `${connection.portIds.join(' ')} ${connection.text}`).join('\n');

    expect(connections.length, 'IBD 必须包含 kind=connection/connector 的连接关系，而不是孤立部件列表').toBeGreaterThan(0);
    expect(connectionRows.every((connection) => connection.portIds.length >= 2), 'IBD 连接线必须引用具体端口端点，不能只连部件节点').toBe(true);
    expect(connectionText, 'IBD 连接必须包含采样返回相关端口连接').toMatch(/采样|样品|sample|sampling/i);
    expect(connectionText, 'IBD 连接必须包含测控通信相关端口连接').toMatch(/测控|通信|遥测|数据|ttc|telemetry|data/i);
    expect(connectionText, 'IBD 连接必须包含电源或热控相关端口连接').toMatch(/电源|供电|热控|power|thermal/i);
  });

  it('从确认数据生成需求追溯矩阵并表达结构列、行为列与覆盖状态', () => {

    const artifacts = generateTianwen2ModelArtifacts(confirmedTianwen2Data);
    const views = artifacts.viewModel.views as unknown as IssueFiveView[];
    const activityView = views.find((view) => view.kind === 'activity');
    const matrixView = views.find((view) => view.kind === 'traceability-matrix');

    expect(matrixView, 'issue #5 要求 JSON 视图模型提供 kind=traceability-matrix 的需求追溯矩阵视图').toBeDefined();

    const rows = matrixView?.rows ?? [];
    const columns = matrixView?.columns ?? [];
    const cells = matrixView?.cells ?? [];
    const activityNodeIds = new Set((activityView?.nodes ?? []).map((node) => node.id));
    const structureColumnIds = new Set(
      columns
        .filter((column) => /structure|subsystem|block|bdd|system/.test(column.kind))
        .map((column) => column.id),
    );
    const behaviorColumnIds = new Set(
      columns
        .filter((column) => /behavior|activity|action/.test(column.kind) || activityNodeIds.has(column.elementId ?? column.id))
        .map((column) => column.id),
    );
    const ttcColumnIds = new Set(
      columns
        .filter((column) => /ttc-communication|测控通信/.test(`${column.id} ${column.elementId ?? ''} ${column.label}`))
        .map((column) => column.id),
    );

    expect(rows.map((row) => row.requirementId ?? row.id), '追溯矩阵必须把关键需求作为行暴露，便于检查 #5 的覆盖关系').toEqual(
      expect.arrayContaining(['REQ-TW2-001', 'REQ-TW2-003', 'REQ-TW2-004']),
    );
    expect(structureColumnIds.size, '追溯矩阵必须包含结构元素列，例如 spacecraft-platform 或 ttc-communication').toBeGreaterThan(0);
    expect(ttcColumnIds.size, '追溯矩阵必须显式包含测控通信结构列，证明 REQ-TW2-004 可追溯到结构元素').toBeGreaterThan(0);
    expect(behaviorColumnIds.size, '追溯矩阵必须包含行为元素列，例如活动图节点 ID，而不只是结构 BDD 列').toBeGreaterThan(0);
    expect(cells.map((cell) => (cell.covered === true ? 'covered' : cell.covered === false ? 'uncovered' : cell.status ?? '')), '矩阵单元格必须能表达 covered 与 uncovered，供 UI 展示覆盖/未覆盖状态').toEqual(
      expect.arrayContaining(['covered', 'uncovered']),
    );
    expect(
      cells.some((cell) => (cell.requirementId ?? cell.rowId) === 'REQ-TW2-004' && ttcColumnIds.has(cell.columnId) && (cell.covered === true ? 'covered' : cell.covered === false ? 'uncovered' : cell.status ?? '') === 'covered'),
      'REQ-TW2-004 的矩阵单元格应把深空测控通信需求标记为已覆盖到测控通信结构列',
    ).toBe(true);
    expect(
      cells.some((cell) => ['REQ-TW2-001', 'REQ-TW2-003', 'REQ-TW2-004'].includes(cell.requirementId ?? cell.rowId ?? '') && behaviorColumnIds.has(cell.columnId)),
      '至少一个关键需求必须追溯到行为列，证明矩阵同时覆盖结构和活动图行为元素',
    ).toBe(true);
  });

  it('校验器为追溯矩阵中的未覆盖需求返回可定位 finding', () => {
    const uncoveredViewModel = {
      schemaVersion: '0.3.0',
      projectId: 'coverage-fixture',
      source: 'confirmed-import-data',
      generatedFrom: 'CoverageFixture',
      views: [
        {
          id: 'requirements-view',
          title: '需求视图',
          kind: 'requirements',
          layout: 'auto',
          layoutEngine: 'deterministic-layered-layout',
          nodes: [{ id: 'REQ-UNCOVERED-001', label: '未覆盖需求', kind: 'requirement' }],
          edges: [],
        },
        {
          id: 'traceability-matrix-view',
          title: '需求追溯矩阵',
          kind: 'traceability-matrix',
          layout: 'auto',
          layoutEngine: 'matrix-layout',
          nodes: [],
          edges: [],
          rows: [{ id: 'REQ-UNCOVERED-001', requirementId: 'REQ-UNCOVERED-001', label: '未覆盖需求' }],
          columns: [{ id: 'spacecraft-platform', elementId: 'spacecraft-platform', kind: 'structure', label: '航天器平台' }],
          cells: [{ rowId: 'REQ-UNCOVERED-001', requirementId: 'REQ-UNCOVERED-001', columnId: 'spacecraft-platform', covered: false }],
        },
      ],
      validation: { status: 'failed', checkedRules: ['schema', 'missing-reference', 'coverage'] },
    };

    const validation = validateViewModel(uncoveredViewModel) as IssueFiveValidationResult;
    const coverageFinding = validation.findings?.find((finding) =>
      /uncovered|coverage|未覆盖|覆盖/i.test(`${finding.code}\n${finding.message ?? ''}`),
    );

    expect(validation.findings, '校验器必须暴露 findings，使 UI 能把覆盖问题区别于 schema 和引用错误').toBeDefined();
    expect(coverageFinding, '未覆盖需求必须生成稳定可识别的 coverage finding，而不是只返回数组长度或笼统失败').toBeDefined();
    expect(coverageFinding?.code, 'finding code 应能稳定识别未覆盖需求，便于 UI 分类展示覆盖校验结果').toMatch(/uncovered|coverage|未覆盖/i);
    expect(
      [coverageFinding?.elementId, coverageFinding?.requirementId, coverageFinding?.target],
      'finding 必须携带需求元素 ID，用户才能从报告跳转到未覆盖需求',
    ).toContain('REQ-UNCOVERED-001');
    expect(
      coverageFinding?.path,
      'finding path 必须指向矩阵行或需求元素路径，避免只给不可操作的文本提示',
    ).toMatch(/\$\.views\[\d+\]\.(rows|nodes)\[\d+\]|REQ-UNCOVERED-001/);
  });

  it('校验器报告 IBD 端口引用缺失、连接端点缺失和接口不完整', () => {
    const invalidViewModel = {
      schemaVersion: '0.4.0',
      projectId: 'ibd-invalid-fixture',
      source: 'confirmed-import-data',
      generatedFrom: 'IssueSixInvalidFixture',
      views: [
        {
          id: 'ibd-invalid-view',
          title: '内部块图错误连接夹具',
          kind: 'ibd',
          layout: 'auto',
          layoutEngine: 'elk-layered',
          nodes: [
            {
              id: 'sampling-return',
              label: '采样返回分系统',
              kind: 'ibd-part',
              ports: [{ id: 'sample-transfer-out', label: '样品转移接口', interfaceId: 'sample-transfer' }],
            },
            {
              id: 'ttc-communication',
              label: '测控通信分系统',
              kind: 'ibd-part',
              ports: [{ id: 'telemetry-downlink', label: '遥测数据接口', interfaceId: 'telemetry-data' }],
            },
            {
              id: 'power-thermal',
              label: '电源与热控分系统',
              kind: 'ibd-part',
              ports: [{ id: 'thermal-control', label: '热控接口', interfaceId: 'thermal-control' }],
            },
          ],
          edges: [
            {
              id: 'missing-port-connector',
              kind: 'connector',
              label: '引用不存在端口的样品转移连接',
              source: 'sampling-return',
              target: 'missing-payload-container',
              sourcePort: 'sample-transfer-out',
              targetPort: 'missing-sample-container-in',
            },
            {
              id: 'missing-endpoint-connector',
              kind: 'connection',
              label: '缺少目标端口的遥测连接',
              source: 'ttc-communication',
              target: 'sampling-return',
              sourcePort: 'telemetry-downlink',
            },
            {
              id: 'incomplete-interface-connector',
              kind: 'connector',
              label: '遥测数据错误连接到热控接口',
              source: 'ttc-communication',
              target: 'power-thermal',
              sourcePort: 'telemetry-downlink',
              targetPort: 'thermal-control',
            },
          ],
        },
      ],
      validation: { status: 'failed', checkedRules: ['schema', 'missing-reference', 'missing-endpoint', 'invalid-connection'] },
    };

    const validation = validateViewModel(invalidViewModel) as IssueFiveValidationResult;
    const findings = [...validation.errors, ...(validation.findings ?? [])];
    const codes = findings.map((finding) => finding.code);
    const findingText = findings.map((finding) => `${finding.code} ${finding.message ?? ''} ${finding.path ?? ''}`).join('\n');

    expect(validation.valid, 'IBD 存在端口引用缺失、连接端点缺失和接口不完整时静态校验必须失败').toBe(false);
    expect(codes, '校验器必须用稳定 code 标识端口引用缺失，不能只返回笼统 schema 错误').toEqual(expect.arrayContaining(['missing-reference']));
    expect(codes, '校验器必须用稳定 code 标识 connection/connector 缺失 sourcePort 或 targetPort').toEqual(expect.arrayContaining(['missing-endpoint']));
    expect(
      codes.some((code) => /incomplete-interface|invalid-connection/.test(code)),
      '校验器必须用 incomplete-interface 或 invalid-connection 稳定标识接口不完整/不匹配的 IBD 连接',
    ).toBe(true);
    expect(findingText, '校验消息或路径必须包含端口语义，便于 UI 定位端口引用缺失').toMatch(/端口|port/i);
    expect(findingText, '校验消息或路径必须包含连接语义，便于 UI 定位 connection/connector').toMatch(/连接|connection|connector/i);
    expect(findingText, '校验消息或路径必须包含接口语义，便于 UI 区分接口不完整或不匹配').toMatch(/接口|interface/i);
  });

  it('校验器发现同一 IBD 连接在 edges 与 connections 双写后发生端口漂移', () => {
    const driftedViewModel = {
      schemaVersion: '0.4.0',
      projectId: 'ibd-drift-fixture',
      source: 'confirmed-import-data',
      generatedFrom: 'IssueSixDriftFixture',
      views: [
        {
          id: 'ibd-drift-view',
          title: '内部块图端口漂移夹具',
          kind: 'ibd',
          layout: 'auto',
          layoutEngine: 'elk-layered',
          nodes: [
            {
              id: 'sampling-return',
              label: '采样返回分系统',
              kind: 'ibd-part',
              ports: [
                { id: 'sample-transfer-out', label: '样品转移接口', interfaceId: 'sample-transfer' },
                { id: 'sample-transfer-backup', label: '备份样品转移接口', interfaceId: 'sample-transfer' },
              ],
            },
            {
              id: 'spacecraft-platform',
              label: '航天器平台',
              kind: 'ibd-part',
              ports: [
                { id: 'sample-return-mechanical-interface', label: '样品接收接口', interfaceId: 'sample-transfer' },
                { id: 'sample-return-backup-interface', label: '备份样品接收接口', interfaceId: 'sample-transfer' },
              ],
            },
          ],
          edges: [
            {
              id: 'connection-drift-sample-transfer',
              kind: 'connection',
              label: '样品转移连接',
              source: 'sampling-return',
              target: 'spacecraft-platform',
              sourcePort: 'sample-transfer-out',
              targetPort: 'sample-return-mechanical-interface',
            },
          ],
          connections: [
            {
              id: 'connection-drift-sample-transfer',
              kind: 'connection',
              label: '样品转移连接',
              source: 'sampling-return',
              target: 'spacecraft-platform',
              sourcePort: 'sample-transfer-backup',
              targetPort: 'sample-return-mechanical-interface',
            },
          ],
        },
      ],
      validation: { status: 'failed', checkedRules: ['schema', 'missing-reference', 'invalid-connection'] },
    };

    const validation = validateViewModel(driftedViewModel) as IssueFiveValidationResult;
    const findings = [...validation.errors, ...(validation.findings ?? [])];
    const codes = findings.map((finding) => finding.code);
    const invalidConnectionText = findings
      .filter((finding) => finding.code === 'invalid-connection')
      .map((finding) => `${finding.code} ${finding.message ?? ''} ${finding.path ?? ''}`)
      .join('\n');

    expect(validation.valid, '同一 IBD 连接在 edges 与 connections 中端口不同步时校验必须失败').toBe(false);
    expect(codes, '端口漂移必须用 invalid-connection 稳定标识，避免被当成普通 schema 或缺失引用').toEqual(expect.arrayContaining(['invalid-connection']));
    expect(invalidConnectionText, '漂移报告必须定位到发生双写的连接 ID').toMatch(/connection-drift-sample-transfer/);
    expect(
      invalidConnectionText,
      '漂移报告的 message/path 必须明确 edges 与 connections 的同步、一致性或漂移语义',
    ).toMatch(/edges.*connections|connections.*edges|同步|一致|漂移|drift/i);
    expect(invalidConnectionText, '漂移报告必须指出 sourcePort/targetPort 端口字段，而不是只给笼统连接错误').toMatch(/sourcePort|targetPort|端口|port/i);
  });

  it('校验器报告参数约束视图中的参数缺失', () => {
    const artifacts = generateTianwen2ModelArtifacts(confirmedTianwen2Data);
    const invalidViewModel = structuredClone(artifacts.viewModel);
    const parameterView = invalidViewModel.views.find((view) =>
      /parameter-constraints|参数约束/i.test(`${view.kind} ${view.id} ${view.title}`),
    );

    expect(
      parameterView,
      '测试必须从真实生成的 viewModel.views 找到参数约束视图，而不是臆造独立参数 schema',
    ).toBeDefined();
    if (!parameterView) return;

    parameterView.parameters = [];

    const validation = validateViewModel(invalidViewModel) as IssueFiveValidationResult;
    const findings = [...validation.errors, ...(validation.findings ?? [])];
    const missingParameterFinding = findings.find((finding) =>
      finding.code === 'missing-parameter'
      && /参数缺失|missing.*parameter/i.test(`${finding.message ?? ''} ${finding.path ?? ''} ${finding.code}`)
      && /parameters|parameterId|参数/i.test(`${finding.path ?? ''} ${finding.message ?? ''}`),
    );

    expect(validation.valid, '参数约束视图缺少 parameters 时静态校验必须失败').toBe(false);
    expect(findings.map((finding) => finding.code), '参数缺失必须用 stable code 标识，便于 UI 分类展示').toEqual(
      expect.arrayContaining(['missing-parameter']),
    );
    expect(
      missingParameterFinding,
      '参数缺失错误必须通过 message 或 path 指向 parameters / parameterId，便于 UI 定位',
    ).toBeDefined();
  });

  it('校验器报告参数约束视图中的单位缺失', () => {
    const artifacts = generateTianwen2ModelArtifacts(confirmedTianwen2Data);
    const invalidViewModel = structuredClone(artifacts.viewModel);
    const parameterView = invalidViewModel.views.find((view) =>
      /parameter-constraints|参数约束/i.test(`${view.kind} ${view.id} ${view.title}`),
    );

    expect(
      parameterView,
      '测试必须从真实生成的 viewModel.views 找到参数约束视图，而不是臆造独立参数 schema',
    ).toBeDefined();
    if (!parameterView) return;

    const firstParameter = parameterView.parameters?.[0] as Record<string, unknown> | undefined;
    expect(firstParameter, '参数约束视图必须保留至少一个参数，才能只破坏单位声明').toBeDefined();
    if (!firstParameter) return;

    delete firstParameter.unit;
    delete firstParameter.unitSymbol;
    delete firstParameter.unitId;

    const validation = validateViewModel(invalidViewModel) as IssueFiveValidationResult;
    const errors = validation.errors;
    const missingUnitFinding = errors.find((finding) =>
      finding.code === 'missing-unit'
      && /单位缺失|missing.*unit|unit|parameters/i.test(`${finding.message ?? ''} ${finding.path ?? ''}`),
    );

    expect(validation.valid, '参数约束视图中的参数缺少单位声明时静态校验必须失败').toBe(false);
    expect(errors.map((finding) => finding.code), '单位缺失必须用 stable code 标识，便于 UI 分类展示').toEqual(
      expect.arrayContaining(['missing-unit']),
    );
    expect(
      missingUnitFinding,
      '单位缺失错误必须通过 message 或 path 指向 unit / parameters，便于 UI 定位',
    ).toBeDefined();
  });

  it('校验器报告参数约束视图中的绑定缺失', () => {
    const artifacts = generateTianwen2ModelArtifacts(confirmedTianwen2Data);
    const invalidViewModel = structuredClone(artifacts.viewModel);
    const parameterView = invalidViewModel.views.find((view) =>
      /parameter-constraints|参数约束/i.test(`${view.kind} ${view.id} ${view.title}`),
    );

    expect(
      parameterView,
      '测试必须从真实生成的 viewModel.views 找到参数约束视图，而不是臆造独立参数 schema',
    ).toBeDefined();
    if (!parameterView) return;

    expect(parameterView.constraints?.length, '绑定缺失样例必须保留约束，避免混成参数缺失').toBeGreaterThan(0);
    expect(parameterView.parameters?.length, '绑定缺失样例必须保留参数，避免混成参数缺失或单位缺失').toBeGreaterThan(0);
    parameterView.bindings = [];

    const validation = validateViewModel(invalidViewModel) as IssueFiveValidationResult;
    const errors = validation.errors;
    const missingBindingFinding = errors.find((finding) =>
      finding.code === 'missing-binding'
      && /绑定缺失|missing.*binding|bindings/i.test(`${finding.message ?? ''} ${finding.path ?? ''}`),
    );

    expect(validation.valid, '参数约束视图中没有约束到参数的绑定时静态校验必须失败').toBe(false);
    expect(errors.map((finding) => finding.code), '绑定缺失必须用 stable code 标识，便于 UI 分类展示').toEqual(
      expect.arrayContaining(['missing-binding']),
    );
    expect(
      missingBindingFinding,
      '绑定缺失错误必须通过 message 或 path 指向 bindings，便于 UI 定位',
    ).toBeDefined();
  });

  it('校验器报告单个参数约束未绑定任何参数', () => {
    const artifacts = generateTianwen2ModelArtifacts(confirmedTianwen2Data);
    const invalidViewModel = structuredClone(artifacts.viewModel);
    const parameterView = invalidViewModel.views.find((view) =>
      /parameter-constraints|参数约束/i.test(`${view.kind} ${view.id} ${view.title}`),
    );

    expect(
      parameterView,
      '测试必须从真实生成的 viewModel.views 找到参数约束视图，而不是臆造独立参数 schema',
    ).toBeDefined();
    if (!parameterView) return;

    const unboundConstraint = parameterView.constraints?.[0];
    expect(unboundConstraint, '绑定覆盖样例必须保留至少一个约束').toBeDefined();
    if (!unboundConstraint) return;

    parameterView.bindings = (parameterView.bindings ?? []).filter(
      (binding) => binding.constraintId !== unboundConstraint.id,
    );
    expect(parameterView.bindings.length, '坏样例应保留其它绑定，证明校验器不是只检查 bindings 数组非空').toBeGreaterThan(0);

    const validation = validateViewModel(invalidViewModel) as IssueFiveValidationResult;
    const errors = validation.errors;
    const missingBindingFinding = errors.find((finding) =>
      finding.code === 'missing-binding'
      && /绑定缺失|missing.*binding|bindings/i.test(`${finding.message ?? ''} ${finding.path ?? ''}`)
      && `${finding.message ?? ''} ${finding.path ?? ''}`.includes(unboundConstraint.id),
    );

    expect(validation.valid, '某个参数约束没有任何参数绑定时静态校验必须失败').toBe(false);
    expect(errors.map((finding) => finding.code), '单个约束未绑定必须用 missing-binding 稳定标识').toEqual(
      expect.arrayContaining(['missing-binding']),
    );
    expect(
      missingBindingFinding,
      '绑定覆盖错误必须指出未绑定的 constraintId，便于 UI 定位具体缺失绑定的约束',
    ).toBeDefined();
  });

  it('校验器报告参数约束视图中的相关模型元素缺失', () => {
    const artifacts = generateTianwen2ModelArtifacts(confirmedTianwen2Data);
    const invalidViewModel = structuredClone(artifacts.viewModel);
    const parameterView = invalidViewModel.views.find((view) =>
      /parameter-constraints|参数约束/i.test(`${view.kind} ${view.id} ${view.title}`),
    );

    expect(
      parameterView,
      '测试必须从真实生成的 viewModel.views 找到参数约束视图，而不是臆造独立参数 schema',
    ).toBeDefined();
    if (!parameterView) return;

    const firstConstraint = parameterView.constraints?.[0] as Record<string, unknown> | undefined;
    expect(firstConstraint, '相关模型元素缺失样例必须保留至少一个约束').toBeDefined();
    if (!firstConstraint) return;

    firstConstraint.relatedElementIds = ['missing-related-element'];

    const validation = validateViewModel(invalidViewModel) as IssueFiveValidationResult;
    const errors = validation.errors;
    const missingReferenceFinding = errors.find((finding) =>
      finding.code === 'missing-reference'
      && /relatedElementIds|missing-related-element|相关模型元素/i.test(`${finding.message ?? ''} ${finding.path ?? ''}`),
    );

    expect(validation.valid, '参数约束视图中的 relatedElementIds 引用不存在时静态校验必须失败').toBe(false);
    expect(errors.map((finding) => finding.code), '相关模型元素缺失必须用 missing-reference 稳定标识').toEqual(
      expect.arrayContaining(['missing-reference']),
    );
    expect(
      missingReferenceFinding,
      '相关模型元素缺失错误必须通过 message 或 path 指向 relatedElementIds / missing-related-element，便于 UI 定位',
    ).toBeDefined();
  });


  it('校验器报告 schema 错误和缺失引用', () => {
    const invalidViewModel = {
      projectId: 'tianwen-2',
      views: [
        {
          id: 'requirements-view',
          title: '需求视图',
          kind: 'requirements',
          nodes: [{ id: 'REQ-TW2-001', label: '小行星近距离探测与取样返回', kind: 'requirement' }],
          edges: [
            {
              id: 'trace-missing-target',
              kind: 'trace',
              source: 'REQ-TW2-001',
              target: 'missing-subsystem',
            },
          ],
          layout: 'auto',
        },
      ],
    };

    const validation = validateViewModel(invalidViewModel);

    expect(validation.valid, '缺少 schemaVersion 且存在悬空引用时校验应失败').toBe(false);
    expect(validation.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(['schema', 'missing-reference']),
    );
    expect(
      validation.errors.map((error) => error.message).join('\n'),
      '校验错误应给出人能读懂的中文或稳定字段名，便于 UI 展示真实失败原因',
    ).toMatch(/schemaVersion|schema|缺少|引用|missing-subsystem|不存在/);
  });
});
