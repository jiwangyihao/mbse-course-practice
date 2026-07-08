import { extractTianwen2ConfirmedData, generateTianwen2ModelArtifacts, validateViewModel } from '../src/domain/modelGeneration';

const confirmedTianwen2Data = {
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



describe('天问二号确认数据领域模型生成契约', () => {
  it('从内置材料使命目标抽取真实候选使命而不是 Markdown 标题', () => {
    const confirmedData = extractTianwen2ConfirmedData([
      '# 天问二号任务与需求材料',
      '',
      '天问二号探测器样例项目用于课程大实践的 MBSE 建模工作台演示。',
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
