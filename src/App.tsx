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
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
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
import {
  createPersistedWorkbenchProjectSnapshot,
  exportCourseDeliveryPackage,
  type CourseDeliveryPackage,
} from './domain/courseDeliveryPackage';
import { workbenchEntry } from './domain/workbench';
import { createAgentSidecarClient } from './domain/agentSidecar';
import type { AgentModelingSession, AgentSidecarEvent, AgentSidecarStatus } from './domain/agentSidecar';

const { Header, Sider, Content, Footer } = Layout;
const { TextArea } = Input;
const { Paragraph, Text, Title } = Typography;

const sampleProject = loadBundledTianwen2Project();
const initialSourceText = sampleProject.sourceMaterials[0]?.content ?? '';
const agentSidecarClient = createAgentSidecarClient();
const initialSidecarStatus: AgentSidecarStatus = {
  state: 'stopped',
  pid: null,
  endpoint: null,
};
type TauriRuntimeWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};


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
  const [sidecarStatus, setSidecarStatus] = useState<AgentSidecarStatus>(initialSidecarStatus);
  const [agentSession, setAgentSession] = useState<AgentModelingSession | null>(null);
  const [isAgentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [persistedProjectSnapshot, setPersistedProjectSnapshot] = useState(() =>
    createPersistedWorkbenchProjectSnapshot(sampleProject),
  );
  const courseDeliveryPackage = useMemo(
    () => exportCourseDeliveryPackage(persistedProjectSnapshot),
    [persistedProjectSnapshot],
  );

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return undefined;
    }

    let cancelled = false;

    void agentSidecarClient
      .status()
      .then((status) => {
        if (!cancelled) {
          setSidecarStatus((current) => (isSameSidecarStatus(current, status) ? current : status));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSidecarStatus({
            state: 'error',
            pid: null,
            endpoint: null,
            message: error instanceof Error ? error.message : 'Agent Sidecar 状态查询失败。',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    setAgentError(null);
    setImportOpen(true);
  }

  function extractCandidates() {
    setAgentSession(null);
    setConfirmedData(extractTianwen2ConfirmedData(sourceText));
  }

  async function startAgentSidecar() {
    setAgentBusy(true);
    setAgentError(null);
    try {
      setSidecarStatus(await agentSidecarClient.start());
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'Agent Sidecar 启动失败。');
    } finally {
      setAgentBusy(false);
    }
  }

  async function stopAgentSidecar() {
    setAgentBusy(true);
    setAgentError(null);
    try {
      setSidecarStatus(await agentSidecarClient.stop());
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'Agent Sidecar 停止失败。');
    } finally {
      setAgentBusy(false);
    }
  }

  async function ensureAgentSidecarRunning() {
    if (sidecarStatus.state !== 'running') {
      setSidecarStatus(await agentSidecarClient.start());
    }
  }

  async function extractAgentCandidates() {
    setAgentBusy(true);
    setAgentError(null);
    try {
      await ensureAgentSidecarRunning();
      const session = await agentSidecarClient.extractCandidates(sourceText);
      const extractionEvent = findAgentEvent(session.events, 'extraction');
      setAgentSession(session);
      if (extractionEvent) {
        setConfirmedData(extractionEvent.confirmedData);
      }
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'Agent 抽取候选失败。');
    } finally {
      setAgentBusy(false);
    }
  }

  function confirmAndGenerate() {
    const nextConfirmedData = confirmedData ?? extractTianwen2ConfirmedData(sourceText);
    const nextArtifacts = generateTianwen2ModelArtifacts(nextConfirmedData);
    setConfirmedData(nextConfirmedData);
    setGeneratedArtifacts(nextArtifacts);
    setPersistedProjectSnapshot(createPersistedWorkbenchProjectSnapshot(sampleProject, nextArtifacts));
    setImportOpen(false);
  }

  async function confirmAgentOutput() {
    const extractionEvent = agentSession ? findAgentEvent(agentSession.events, 'extraction') : undefined;
    const draftEvent = agentSession ? findAgentEvent(agentSession.events, 'model-draft') : undefined;

    if (draftEvent) {
      setGeneratedArtifacts(draftEvent.draft);
      setPersistedProjectSnapshot(createPersistedWorkbenchProjectSnapshot(sampleProject, draftEvent.draft));
      setImportOpen(false);
      return;
    }

    if (!extractionEvent) {
      setAgentError('Agent 输出缺少可确认的抽取结果。');
      return;
    }

    setAgentBusy(true);
    setAgentError(null);
    try {
      await ensureAgentSidecarRunning();
      setAgentSession(await agentSidecarClient.generateDraft(sourceText, extractionEvent.confirmedData));
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'Agent 模型草案生成失败。');
    } finally {
      setAgentBusy(false);
    }
  }

  function rejectAgentOutput() {
    setAgentSession(null);
    setConfirmedData(null);
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

            <Card size="small" title="Agent Sidecar 状态" className="sider-card sidecar-card">
              <Space orientation="vertical" size={8} className="sidecar-status">
                <Space wrap>
                  <Tag color={sidecarStatus.state === 'running' ? 'success' : sidecarStatus.state === 'error' ? 'error' : 'default'}>
                    {sidecarStatus.state}
                  </Tag>
                  <Text type="secondary">{sidecarStatus.endpoint ?? '未连接本地 Sidecar'}</Text>
                </Space>
                {sidecarStatus.message ? <Text type="secondary">{sidecarStatus.message}</Text> : null}
                {agentError ? <Alert type="error" showIcon message={agentError} /> : null}
                <Space wrap>
                  <Button size="small" onClick={startAgentSidecar} loading={isAgentBusy}>
                    启动 Agent Sidecar
                  </Button>
                  <Button size="small" onClick={stopAgentSidecar} disabled={isAgentBusy}>
                    停止 Agent Sidecar
                  </Button>
                </Space>
              </Space>
            </Card>
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

                      <DeliveryPackageCard deliveryPackage={courseDeliveryPackage} />

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
                    <GeneratedModelWorkspace artifacts={generatedArtifacts} deliveryPackage={courseDeliveryPackage} />
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
        destroyOnHidden
      >
        <Space orientation="vertical" size={16} className="import-wizard">
          <Alert
            type="info"
            showIcon
            title="一次性确认向导"
            description="粘贴或使用内置天问二号材料，抽取结构化候选项；确认后生成模型工件并回到项目工作台。"
          />
          {agentSession ? (
            <AgentDraftReview session={agentSession} onConfirm={confirmAgentOutput} onReject={rejectAgentOutput} />
          ) : confirmedData ? (
            <CandidateReview confirmedData={confirmedData} onConfirm={confirmAndGenerate} />
          ) : (
            <>
              <TextArea
                aria-label="源材料粘贴内容"
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                rows={7}
              />
              <Space wrap>
                <Button type="primary" onClick={extractAgentCandidates} loading={isAgentBusy}>
                  抽取候选
                </Button>
              </Space>
            </>
          )}
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

function AgentDraftReview({
  session,
  onConfirm,
  onReject,
}: {
  session: AgentModelingSession;
  onConfirm: () => void | Promise<void>;
  onReject: () => void;
}) {
  const extractionEvent = findAgentEvent(session.events, 'extraction');
  const draftEvent = findAgentEvent(session.events, 'model-draft');
  const errorEvents = session.events.filter((event) => event.type === 'error');
  const suggestionEvents = session.events.filter((event) => event.type === 'suggestion');

  return (
    <Space orientation="vertical" size={12} className="agent-draft-review">
      <Alert
        type="success"
        showIcon
        title={draftEvent ? 'Agent 模型草案' : 'Agent 抽取结果'}
        description={
          draftEvent
            ? 'Sidecar 已在用户确认抽取结果后返回模型草案；确认后复用现有模型视图与校验路径。'
            : 'Sidecar 已返回结构化抽取结果；请先确认或拒绝候选项，再生成模型草案。'
        }
      />
      <Card size="small" title="结构化事件流">
        <div className="agent-event-list">
          {session.events.map((event, index) => (
            <div className="agent-event-row" key={`${event.type}-${index}`}>
              <Tag color={event.type === 'error' ? 'red' : event.type === 'suggestion' ? 'gold' : event.type === 'model-draft' ? 'green' : 'blue'}>{event.type}</Tag>
              <Text>{event.type === 'suggestion' ? '修正建议已返回' : event.message}</Text>
            </div>
          ))}
        </div>
      </Card>
      {extractionEvent ? (
        <>
          <Card size="small" title="候选使命">
            <Paragraph>{extractionEvent.confirmedData.mission}</Paragraph>
          </Card>
          <Card size="small" title="候选需求">
            <div className="candidate-list">
              {extractionEvent.confirmedData.requirements.map((requirement) => (
                <div className="candidate-row" key={requirement.id}>
                  <Text code>{requirement.id}</Text>
                  <Text strong>{requirement.title}</Text>
                </div>
              ))}
            </div>
          </Card>
          <Card size="small" title="候选分系统">
            <Space wrap>
              {extractionEvent.confirmedData.subsystems.map((subsystem) => (
                <Tag key={subsystem.id}>{subsystem.name}</Tag>
              ))}
            </Space>
          </Card>
        </>
      ) : null}
      {draftEvent ? (
        <Card size="small" title="模型草案摘要">
          <Descriptions
            bordered
            size="small"
            column={1}
            items={[
              { key: 'sysml', label: 'SysML v2', children: `${draftEvent.draft.sysmlText.length} 字符` },
              { key: 'views', label: '视图模型草案', children: `${draftEvent.draft.viewModel.views.length} 个视图` },
              { key: 'validation', label: '静态校验', children: draftEvent.draft.validation.valid ? '通过' : '失败' },
            ]}
          />
        </Card>
      ) : null}
      {suggestionEvents.length > 0 ? (
        <Card size="small" title="修正建议">
          <div className="candidate-list">
            {suggestionEvents.map((event, index) => (
              <div className="candidate-row" key={`${event.type}-${index}`}>
                <Tag color={event.severity === 'warning' ? 'gold' : 'blue'}>{event.target}</Tag>
                <Tag color={event.severity === 'warning' ? 'gold' : 'blue'}>{event.severity}</Tag>
                <Text>{event.recommendation}</Text>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {errorEvents.map((event, index) => (
        <Alert key={index} type="warning" showIcon message={event.message} />
      ))}
      <Space wrap>
        <Button onClick={onReject}>拒绝 Agent 输出</Button>
        <Button type="primary" onClick={onConfirm} disabled={!draftEvent && !extractionEvent}>
          {draftEvent ? '确认 Agent 输出' : '确认 Agent 输出并生成模型草案'}
        </Button>
      </Space>
    </Space>
  );
}

function GeneratedModelWorkspace({ artifacts, deliveryPackage }: { artifacts: ModelGenerationResult; deliveryPackage: CourseDeliveryPackage }) {
  const requirementView = artifacts.viewModel.views.find((view) => view.kind === 'requirements');
  const bddView = artifacts.viewModel.views.find((view) => view.kind === 'bdd');
  const ibdView = artifacts.viewModel.views.find((view) => view.kind === 'ibd');
  const activityView = artifacts.viewModel.views.find((view) => view.kind === 'activity');
  const traceabilityMatrixView = artifacts.viewModel.views.find((view) => view.kind === 'traceability-matrix');
  const parameterConstraintsView = artifacts.viewModel.views.find((view) => view.kind === 'parameter-constraints');

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
            <Tag color={artifacts.validation.findings.length === 0 ? 'success' : 'warning'}>覆盖校验{artifacts.validation.findings.length === 0 ? '通过' : '有缺口'}</Tag>
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

      <DeliveryPackageCard deliveryPackage={deliveryPackage} />

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
        {ibdView ? (
          <Col xs={24} xl={12}>
            <ModelViewCard view={ibdView} />
          </Col>
        ) : null}
        {activityView ? (
          <Col xs={24} xl={12}>
            <ModelViewCard view={activityView} />
          </Col>
        ) : null}
        {parameterConstraintsView ? (
          <Col xs={24}>
            <ParameterConstraintCard view={parameterConstraintsView} />
          </Col>
        ) : null}
        {traceabilityMatrixView ? (
          <Col xs={24}>
            <TraceabilityMatrixCard view={traceabilityMatrixView} findings={artifacts.validation.findings} />
          </Col>
        ) : null}
      </Row>
    </Space>
  );
}

function DeliveryPackageCard({ deliveryPackage }: { deliveryPackage: CourseDeliveryPackage }) {
  const rows = [
    ...deliveryPackage.checklist.map((item) => ({
      id: item.id,
      kind: '检查项',
      label: `交付检查：${item.id}`,
      path: `${item.status}: ${item.artifactIds.join('、')}`,
    })),
    ...deliveryPackage.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.type,
      label: artifact.title,
      path: artifact.path,
    })),
  ];

  return (
    <Card
      className="workspace-card"
      title="课程交付包清单"
      extra={<Tag color="success">{deliveryPackage.source}</Tag>}
      aria-label="课程交付包清单"
    >
      <Paragraph>
        导出只消费已保存项目状态，交付包包含源码工程、可运行 Tauri 应用、天问二号样例工程、模型工件、校验结果、报告素材、演示说明和交付清单。
      </Paragraph>
      <Table className="artifact-table" columns={artifactColumns} dataSource={rows} pagination={false} rowKey="id" size="small" />
    </Card>
  );
}

type DiagramPortData = {
  id: string;
  label: string;
  kind: string;
};

type DiagramNodeData = {
  label: string;
  meta: string;
  ports: DiagramPortData[];
};

const elk = new ELK();
const flowNodeWidth = 220;
const flowNodeHeight = 82;
const ibdFlowNodeHeight = 144;

const ibdNodeTypes = { ibdPart: IbdPartNode };

function ModelViewCard({ view }: { view: GeneratedView }) {
  const diagramConnections = useMemo(() => (view.kind === 'ibd' && view.connections ? view.connections : view.edges), [view]);
  const initialNodes = useMemo<Node<DiagramNodeData>[]>(
    () =>
      view.nodes.map((node) => {
        const ports = collectDiagramPorts(view, node);
        return {
          id: node.id,
          type: view.kind === 'ibd' ? 'ibdPart' : 'default',
          position: node.position,
          data: {
            label: node.label,
            meta: node.id,
            ports,
          },
          className: `flow-node flow-node-${node.kind}`,
        };
      }),
    [view],
  );
  const initialEdges = useMemo<Edge[]>(
    () =>
      diagramConnections.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourcePort,
        targetHandle: edge.targetPort,
        label: formatDiagramEdgeLabel(edge),
        type: 'smoothstep',
        className: `flow-edge flow-edge-${edge.kind}`,
      })),
    [diagramConnections],
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
        height: node.data.ports.length > 0 ? Math.max(ibdFlowNodeHeight, 76 + node.data.ports.length * 24) : flowNodeHeight,
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
      {view.kind === 'ibd' ? (
        <Alert
          showIcon
          type="info"
          className="ibd-boundary-alert"
          title="IBD 当前是可视化 + 静态校验"
          description="展示天问二号内部部件、端口和连接线；不提供完整拖拽式图编辑。"
        />
      ) : null}
      <ReactFlowProvider>
        <div className="react-flow-canvas" aria-label={`${view.title} 自动布局图`}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={view.kind === 'ibd' ? ibdNodeTypes : undefined}
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

function IbdPartNode({ data }: NodeProps<Node<DiagramNodeData>>) {
  return (
    <div className="ibd-part-node">
      <Text strong>{data.label}</Text>
      <Space orientation="vertical" size={2} className="ibd-port-list">
        {data.ports.map((port, index) => {
          const top = 46 + index * 24;
          return (
            <span key={port.id} className="ibd-port-row">
              <Handle id={port.id} type="target" position={Position.Left} className="ibd-port-handle" style={{ top }} />
              <Text type="secondary">{port.label}</Text>
              <Text code>{port.id}</Text>
              <Handle id={port.id} type="source" position={Position.Right} className="ibd-port-handle" style={{ top }} />
            </span>
          );
        })}
      </Space>
    </div>
  );
}

function collectDiagramPorts(view: GeneratedView, node: GeneratedView['nodes'][number]): DiagramPortData[] {
  const viewPorts = view.kind === 'ibd' ? (view.ports ?? []).filter((port) => port.ownerId === node.id) : [];
  const nodePorts = node.ports ?? [];
  const portsById = new Map<string, DiagramPortData>();
  for (const port of [...viewPorts, ...nodePorts]) {
    portsById.set(port.id, { id: port.id, label: port.label, kind: port.kind });
  }
  return Array.from(portsById.values());
}

function formatDiagramEdgeLabel(edge: GeneratedView['edges'][number] | NonNullable<GeneratedView['connections']>[number]) {
  if (edge.sourcePort && edge.targetPort) {
    return `${edge.label ?? edge.kind}: ${edge.sourcePort} → ${edge.targetPort}`;
  }

  return edge.label ?? edge.kind;
 }

function ParameterConstraintCard({ view }: { view: GeneratedView }) {
  const constraints = view.constraints ?? [];
  const parameters = view.parameters ?? [];
  const bindings = view.bindings ?? [];
  const formatRelatedElements = (relatedElementIds: string[]) => (relatedElementIds.length > 0 ? relatedElementIds.join('、') : '未声明');

  return (
    <Card className="workspace-card" title={view.title} extra={<Tag color="blue">只读静态校验</Tag>}>
      <Alert
        title="只读展示与静态校验"
        showIcon
        type="info"
        className="parameter-boundary-alert"
        description="展示约束、参数绑定、单位和相关模型元素；不执行仿真、求解或 Modelica 联合仿真。"
      />
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="约束">
            <Table
              size="small"
              pagination={false}
              dataSource={constraints.map((constraint) => ({ key: constraint.id, ...constraint }))}
              columns={[
                {
                  title: '约束',
                  dataIndex: 'label',
                  key: 'label',
                  render: (_: unknown, constraint: (typeof constraints)[number]) => (
                    <Space orientation="vertical" size={0}>
                      <Text strong>{constraint.label}</Text>
                      <Text code>{constraint.id}</Text>
                    </Space>
                  ),
                },
                { title: '表达式', dataIndex: 'expression', key: 'expression' },
                {
                  title: '相关模型元素',
                  dataIndex: 'relatedElementIds',
                  key: 'relatedElementIds',
                  render: (relatedElementIds: string[]) => <Text>{formatRelatedElements(relatedElementIds)}</Text>,
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="参数与单位">
            <Table
              size="small"
              pagination={false}
              dataSource={parameters.map((parameter) => ({ key: parameter.id, ...parameter }))}
              columns={[
                {
                  title: '参数',
                  dataIndex: 'label',
                  key: 'label',
                  render: (_: unknown, parameter: (typeof parameters)[number]) => (
                    <Space orientation="vertical" size={0}>
                      <Text strong>{parameter.label}</Text>
                      <Text code>{parameter.id}</Text>
                    </Space>
                  ),
                },
                { title: '单位', dataIndex: 'unit', key: 'unit', render: (unit: string) => <Text code>{unit}</Text> },
                {
                  title: '相关模型元素',
                  dataIndex: 'relatedElementIds',
                  key: 'relatedElementIds',
                  render: (relatedElementIds: string[]) => <Text>{formatRelatedElements(relatedElementIds)}</Text>,
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24}>
          <Card size="small" title="参数绑定">
            <Table
              size="small"
              pagination={false}
              dataSource={bindings.map((binding) => ({ key: binding.id, ...binding }))}
              columns={[
                {
                  title: '绑定',
                  dataIndex: 'label',
                  key: 'label',
                  render: (_: unknown, binding: (typeof bindings)[number]) => (
                    <Space orientation="vertical" size={0}>
                      <Text strong>{binding.label}</Text>
                      <Text code>{binding.id}</Text>
                    </Space>
                  ),
                },
                {
                  title: '约束',
                  dataIndex: 'constraintId',
                  key: 'constraintId',
                  render: (constraintId: string) => <Text code>{constraintId}</Text>,
                },
                {
                  title: '参数',
                  dataIndex: 'parameterId',
                  key: 'parameterId',
                  render: (parameterId: string) => <Text code>{parameterId}</Text>,
                },
                {
                  title: '相关模型元素',
                  dataIndex: 'relatedElementIds',
                  key: 'relatedElementIds',
                  render: (relatedElementIds: string[]) => <Text>{formatRelatedElements(relatedElementIds)}</Text>,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Card>
  );
}

function TraceabilityMatrixCard({
  view,
  findings,
}: {
  view: GeneratedView;
  findings: ModelGenerationResult['validation']['findings'];
}) {
  const rows = view.rows ?? [];
  const columns = view.columns ?? [];
  const cells = view.cells ?? [];
  const cellsByKey = new Map(cells.map((cell) => [`${cell.requirementId}:${cell.columnId}`, cell]));
  const dataSource = rows.map((row) => ({ key: row.id, ...row }));
  const tableColumns = [
    {
      title: '需求',
      dataIndex: 'requirementId',
      key: 'requirement',
      fixed: 'left' as const,
      render: (_: unknown, row: (typeof dataSource)[number]) => (
        <Space orientation="vertical" size={0}>
          <Text code>{row.requirementId}</Text>
          <Text>{row.label}</Text>
        </Space>
      ),
    },
    ...columns.map((column) => ({
      title: (
        <Space orientation="vertical" size={0}>
          <Text>{column.label}</Text>
          <Tag color={column.kind === 'structure' ? 'green' : 'purple'}>{column.kind === 'structure' ? '结构元素' : '行为元素'}</Tag>
        </Space>
      ),
      dataIndex: column.id,
      key: column.id,
      render: (_: unknown, row: (typeof dataSource)[number]) => {
        const cell = cellsByKey.get(`${row.requirementId}:${column.id}`);
        const covered = cell?.covered === true;
        return (
          <Space orientation="vertical" size={0}>
            <Tag color={covered ? 'success' : 'warning'}>{covered ? '已覆盖' : '未覆盖'}</Tag>
            {cell?.evidence ? <Text type="secondary">{cell.evidence}</Text> : null}
          </Space>
        );
      },
    })),
  ];

  return (
    <Card
      className="workspace-card"
      title={view.title}
      extra={<Tag color={findings.length === 0 ? 'success' : 'warning'}>覆盖校验{findings.length === 0 ? '通过' : '有缺口'}</Tag>}
    >
      {findings.length > 0 ? (
        <Alert
          showIcon
          type="warning"
          message="覆盖校验发现未覆盖需求"
          description={findings.map((finding) => `${finding.requirementId}：${finding.message}`).join('；')}
        />
      ) : null}
      <Table
        className="traceability-matrix"
        columns={tableColumns}
        dataSource={dataSource}
        pagination={false}
        scroll={{ x: true }}
        size="small"
      />
    </Card>
  );
}

function findAgentEvent<TType extends AgentSidecarEvent['type']>(
  events: AgentSidecarEvent[],
  type: TType,
): Extract<AgentSidecarEvent, { type: TType }> | undefined {
  return events.find((event): event is Extract<AgentSidecarEvent, { type: TType }> => event.type === type);
}

function isSameSidecarStatus(left: AgentSidecarStatus, right: AgentSidecarStatus) {
  return left.state === right.state && left.pid === right.pid && left.endpoint === right.endpoint && left.message === right.message;
}

function hasTauriRuntime() {
  return typeof window !== 'undefined' && Boolean((window as TauriRuntimeWindow).__TAURI_INTERNALS__);
}
