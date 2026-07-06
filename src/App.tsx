import { useEffect, useMemo, useState } from 'react';
import {
  ApartmentOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Flex,
  Input,
  Layout,
  Modal,
  Row,
  Space,
  Statistic,
  Steps,
  Table,
  Tag,
  Tree,
  Typography,
  theme,
} from 'antd';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled';
import {
  extractTianwen2ConfirmedData,
  generateTianwen2ModelArtifacts,
  type ConfirmedTianwen2Data,
  type GeneratedView,
  type ModelGenerationResult,
} from './domain/modelGeneration';
import { loadBundledTianwen2Project } from './domain/sampleProject';
import { workbenchEntry } from './domain/workbench';

const { Header, Sider, Content, Footer } = Layout;
const { TextArea } = Input;
const { Paragraph, Text, Title } = Typography;

const sampleProject = loadBundledTianwen2Project();
const initialSourceText = sampleProject.sourceMaterials[0]?.content ?? '';

const baseProjectResources = [
  ...sampleProject.sourceMaterials.map((material) => ({
    icon: <FileTextOutlined />,
    id: material.id,
    label: material.title,
    kind: '源材料',
    path: material.path,
  })),
  ...sampleProject.modelArtifacts.map((artifact) => ({
    icon: artifact.kind === 'sysml-v2' ? <ApartmentOutlined /> : <DatabaseOutlined />,
    id: artifact.id,
    label: artifact.kind === 'json-view-model' ? '确认生成的视图模型 JSON 工件' : artifact.title,
    kind: artifact.kind === 'sysml-v2' ? 'SysML v2' : '视图模型',
    path: artifact.path,
  })),
];

const artifactColumns = [
  {
    title: '工件类型',
    dataIndex: 'kind',
    key: 'kind',
    width: 132,
    render: (kind: string) => <Tag color="blue">{kind}</Tag>,
  },
  {
    title: '名称',
    dataIndex: 'label',
    key: 'label',
  },
  {
    title: '路径',
    dataIndex: 'path',
    key: 'path',
    render: (path: string) => <Text code>{path}</Text>,
  },
];

const nextWorkflowSteps = [
  {
    title: '材料导入与粘贴',
    subTitle: '#3',
    content: '一次性新建/更新项目流程，不作为当前工作台常驻页签。',
  },
  {
    title: '导入确认向导',
    subTitle: '#3',
    content: '仅在导入材料后进入，确认完成后回到项目工作台。',
  },
  {
    title: 'Agent Sidecar 生成模型草案',
    subTitle: '#4',
    content: '由 Tauri 管理 Sidecar，并以结构化事件返回进度与结果。',
  },
  {
    title: '多视图与静态校验工作区',
    subTitle: '#5-#7',
    content: '在真实模型工件生成后进入对应视图，不作为导入向导常驻导航。',
  },
];

export default function App() {
  const [isImportOpen, setImportOpen] = useState(false);
  const [sourceText, setSourceText] = useState(initialSourceText);
  const [confirmedData, setConfirmedData] = useState<ConfirmedTianwen2Data | null>(null);
  const [generatedArtifacts, setGeneratedArtifacts] = useState<ModelGenerationResult | null>(null);

  const projectResources = useMemo(
    () => [
      ...baseProjectResources,
      ...(generatedArtifacts
        ? [
            {
              icon: <ApartmentOutlined />,
              id: 'generated-sysml-text',
              label: '本次确认生成的模型文本',
              kind: '生成工件',
              path: 'memory://confirmed-import/tianwen-2.sysml',
            },
            {
              icon: <DatabaseOutlined />,
              id: 'generated-view-model-json',
              label: '本次确认生成的视图 JSON',
              kind: '生成工件',
              path: 'memory://confirmed-import/view-model.json',
            },
          ]
        : []),
    ],
    [generatedArtifacts],
  );

  const resourceTreeData = useMemo(
    () => [
      {
        title: sampleProject.manifest.name,
        key: sampleProject.manifest.id,
        children: projectResources.map((resource) => ({
          key: resource.id,
          title: (
            <Space orientation="vertical" size={2}>
              <Space size={8} wrap>
                <span className="resource-icon" aria-hidden="true">
                  {resource.icon}
                </span>
                <Tag color="blue">{resource.kind}</Tag>
                <Text strong>{resource.label}</Text>
              </Space>
              <Text type="secondary">{resource.path}</Text>
            </Space>
          ),
        })),
      },
    ],
    [projectResources],
  );

  function openImportWizard() {
    setImportOpen(true);
  }

  function extractCandidates() {
    setConfirmedData(extractTianwen2ConfirmedData(sourceText));
  }

  function confirmAndGenerate() {
    const nextConfirmedData = confirmedData ?? extractTianwen2ConfirmedData(sourceText);
    setConfirmedData(nextConfirmedData);
    setGeneratedArtifacts(generateTianwen2ModelArtifacts(nextConfirmedData));
    setImportOpen(false);
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          borderRadius: 12,
          colorPrimary: '#1677ff',
          fontFamily:
            "Inter, 'Microsoft YaHei', 'PingFang SC', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
      }}
    >
      <main className="workbench-shell" aria-labelledby="workbench-title">
        <Layout className="workbench-layout">
          <Sider className="project-sider" width={360} theme="light" aria-label="项目资源树">
            <Flex className="brand-block" gap={12} align="center">
              <div className="app-mark" aria-hidden="true">
                MBSE
              </div>
              <div>
                <Text className="section-eyebrow">{workbenchEntry.courseName}</Text>
                <Title id="workbench-title" level={3} className="brand-title">
                  {workbenchEntry.productName}
                </Title>
              </div>
            </Flex>

            <Card size="small" title="当前项目" className="sider-card">
              <Button block type="primary" size="large" className="project-open-button">
                <Space orientation="vertical" size={0} align="start">
                  <Text className="project-open-title">{sampleProject.manifest.name}</Text>
                  <Text className="project-open-id">{sampleProject.manifest.id}</Text>
                </Space>
              </Button>
            </Card>

            <Card
              size="small"
              title="项目资源"
              className="sider-card resource-card"
              aria-label="模型工件资源树"
            >
              <Tree
                className="resource-tree"
                defaultExpandAll
                selectable={false}
                treeData={resourceTreeData}
              />
            </Card>

            <Alert
              className="runtime-alert"
              icon={<DesktopOutlined />}
              title="Tauri 桌面壳已运行"
              description="当前工作台加载内置天问二号样例项目；导入确认后由领域生成器产出模型工件。"
              type="success"
              showIcon
            />
          </Sider>

          <Layout className="workspace-layout">
            <Header className="workspace-header">
              <Flex justify="space-between" align="center" gap={24} wrap="wrap">
                <div>
                  <Text className="section-eyebrow">课程大实践项目入口</Text>
                  <Title level={2} className="workspace-title">
                    {sampleProject.manifest.name}
                  </Title>
                </div>
                <Space wrap aria-label="项目操作">
                  <Button type="primary" icon={<FolderOpenOutlined />} size="large">
                    打开内置天问二号样例项目
                  </Button>
                  <Button size="large" onClick={openImportWizard}>
                    新建项目 / 导入材料（#3）
                  </Button>
                </Space>
              </Flex>
            </Header>

            <Content className="workspace-content" aria-label="项目主页工作区">
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={generatedArtifacts ? 24 : 12}>
                  <Card
                    className="workspace-card full-height-card"
                    title={
                      <Space>
                        <RocketOutlined />
                        <span>项目主页</span>
                      </Space>
                    }
                    extra={<Tag color="geekblue">Project Home</Tag>}
                  >
                    <Paragraph className="lead-copy">{sampleProject.manifest.description}</Paragraph>
                    <Descriptions
                      bordered
                      column={1}
                      size="middle"
                      items={[
                        {
                          key: 'id',
                          label: '项目 ID',
                          children: sampleProject.manifest.id,
                        },
                        {
                          key: 'caseName',
                          label: '演示案例',
                          children: sampleProject.manifest.caseName,
                        },
                        {
                          key: 'productBoundary',
                          label: '产品边界',
                          children: sampleProject.manifest.productBoundary,
                        },
                        {
                          key: 'workspaceBoundary',
                          label: '工作区边界',
                          children: sampleProject.manifest.workspaceBoundary,
                        },
                      ]}
                    />
                  </Card>
                </Col>

                {!generatedArtifacts ? (
                  <Col xs={24} xl={12}>
                    <Space orientation="vertical" size={16} className="right-stack">
                      <Card
                        className="workspace-card"
                        title={
                          <Space>
                            <SafetyCertificateOutlined />
                            <span>最小项目契约</span>
                          </Space>
                        }
                        extra={<Tag color="blue">Artifact Contract</Tag>}
                      >
                        <Table
                          className="artifact-table"
                          columns={artifactColumns}
                          dataSource={projectResources}
                          pagination={false}
                          rowKey="id"
                          size="small"
                        />
                      </Card>

                      <Card
                        className="workspace-card"
                        title="后续流程边界"
                        extra={<Tag color="gold">Deferred Workflow</Tag>}
                      >
                        <Steps
                          className="workflow-steps"
                          current={-1}
                          orientation="vertical"
                          size="small"
                          items={nextWorkflowSteps}
                        />
                      </Card>
                    </Space>
                  </Col>
                ) : (
                  <Col xs={24}>
                    <GeneratedModelWorkspace artifacts={generatedArtifacts} />
                  </Col>
                )}
              </Row>
            </Content>

            <Footer className="workspace-footer">
              <Space size={16} separator={<span className="footer-separator" />} wrap>
                <Statistic title="源材料" value={sampleProject.sourceMaterials.length} />
                <Statistic title="模型工件" value={projectResources.length - sampleProject.sourceMaterials.length} />
                <Statistic title="视图模型" value={generatedArtifacts?.viewModel.views.length ?? sampleProject.viewModelSummary.views.length} />
                <Text type="secondary">{workbenchEntry.workspaceBoundary}</Text>
              </Space>
            </Footer>
          </Layout>
        </Layout>
      </main>

      <Modal
        title="材料导入与确认向导"
        open={isImportOpen}
        onCancel={() => setImportOpen(false)}
        footer={null}
        width={920}
        transitionName=""
        maskTransitionName=""
      >
        <Space orientation="vertical" size={16} className="import-wizard">
          <Alert
            type="info"
            showIcon
            title="一次性确认向导"
            description="粘贴或使用内置天问二号材料，抽取结构化候选项；确认后生成模型工件并回到项目工作台。"
          />
          {confirmedData ? null : (
            <>
              <TextArea
                aria-label="源材料粘贴内容"
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                rows={7}
              />
              <Button type="primary" onClick={extractCandidates}>
                抽取候选
              </Button>
            </>
          )}

          {confirmedData ? <CandidateReview confirmedData={confirmedData} onConfirm={confirmAndGenerate} /> : null}
        </Space>
      </Modal>
    </ConfigProvider>
  );
}

function CandidateReview({
  confirmedData,
  onConfirm,
}: {
  confirmedData: ConfirmedTianwen2Data;
  onConfirm: () => void;
}) {
  return (
    <Space orientation="vertical" size={12} className="candidate-review">
      <Card size="small" title="候选使命">
        <Paragraph>{confirmedData.mission}</Paragraph>
      </Card>
      <Card size="small" title="候选需求">
        <div className="candidate-list">
          {confirmedData.requirements.map((requirement) => (
            <div className="candidate-row" key={requirement.id}>
              <Text code>{requirement.id}</Text>
              <Text strong>{requirement.title}</Text>
            </div>
          ))}
        </div>
      </Card>
      <Card size="small" title="候选分系统">
        <Space wrap>
          {confirmedData.subsystems.map((subsystem) => (
            <Tag key={subsystem.id}>{subsystem.name}</Tag>
          ))}
        </Space>
      </Card>
      <Button type="primary" onClick={onConfirm}>
        确认生成
      </Button>
    </Space>
  );
}

function GeneratedModelWorkspace({ artifacts }: { artifacts: ModelGenerationResult }) {
  const requirementView = artifacts.viewModel.views.find((view) => view.kind === 'requirements');
  const bddView = artifacts.viewModel.views.find((view) => view.kind === 'bdd');

  return (
    <Space orientation="vertical" size={16} className="generated-workspace">
      <Card
        className="workspace-card"
        title="确认生成的模型工件"
        extra={
          <Space wrap>
            <Tag color="blue">自动布局</Tag>
            <Tag color={artifacts.validation.valid ? 'success' : 'error'}>Schema 校验通过</Tag>
            <Tag color={artifacts.validation.valid ? 'success' : 'error'}>引用校验通过</Tag>
          </Space>
        }
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card size="small" title="SysML v2 文本">
              <pre className="artifact-preview">{artifacts.sysmlText}</pre>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card size="small" title="JSON 视图模型">
              <Descriptions
                bordered
                size="small"
                column={1}
                items={[
                  { key: 'schema', label: 'schemaVersion', children: artifacts.viewModel.schemaVersion },
                  { key: 'project', label: 'projectId', children: artifacts.viewModel.projectId },
                  { key: 'views', label: 'views', children: artifacts.viewModel.views.length },
                  { key: 'rules', label: '校验规则', children: artifacts.viewModel.validation.checkedRules.join(', ') },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        {requirementView ? (
          <Col xs={24} xl={12}>
            <ModelViewCard view={requirementView} />
          </Col>
        ) : null}
        {bddView ? (
          <Col xs={24} xl={12}>
            <ModelViewCard view={bddView} />
          </Col>
        ) : null}
      </Row>
    </Space>
  );
}

type DiagramNodeData = {
  label: string;
  meta: string;
};

const elk = new ELK();
const flowNodeWidth = 190;
const flowNodeHeight = 82;

function ModelViewCard({ view }: { view: GeneratedView }) {
  const initialNodes = useMemo<Node<DiagramNodeData>[]>(
    () =>
      view.nodes.map((node) => ({
        id: node.id,
        type: 'default',
        position: node.position,
        data: {
          label: node.label,
          meta: node.id,
        },
        className: `flow-node flow-node-${node.kind}`,
      })),
    [view],
  );
  const initialEdges = useMemo<Edge[]>(
    () =>
      view.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label ?? edge.kind,
        type: 'smoothstep',
        className: `flow-edge flow-edge-${edge.kind}`,
      })),
    [view],
  );
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  useEffect(() => {
    let cancelled = false;
    setNodes(initialNodes);
    setEdges(initialEdges);

    const graph: ElkNode = {
      id: view.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': view.kind === 'requirements' ? 'RIGHT' : 'DOWN',
        'elk.spacing.nodeNode': '48',
        'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      },
      children: initialNodes.map((node) => ({
        id: node.id,
        width: flowNodeWidth,
        height: flowNodeHeight,
      })),
      edges: initialEdges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
    };

    void elk.layout(graph).then((layoutedGraph) => {
      if (cancelled) {
        return;
      }

      const layoutedById = new Map(
        layoutedGraph.children?.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]) ?? [],
      );
      setNodes(
        initialNodes.map((node) => ({
          ...node,
          position: layoutedById.get(node.id) ?? node.position,
        })),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [initialEdges, initialNodes, view.id, view.kind]);

  return (
    <Card className="workspace-card" title={view.title} extra={<Tag>{view.layoutEngine}</Tag>}>
      <ReactFlowProvider>
        <div className="react-flow-canvas" aria-label={`${view.title} 自动布局图`}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <Background />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </ReactFlowProvider>
    </Card>
  );
}
