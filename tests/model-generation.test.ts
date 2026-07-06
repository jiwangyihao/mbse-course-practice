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
