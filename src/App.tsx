import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ApartmentOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { listen } from '@tauri-apps/api/event';
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
  Progress,
  Row,
  Space,
  Statistic,
  Steps,
  Table,
  Tabs,
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
import { type ConfirmedTianwen2Data, type GeneratedView, type ModelGenerationResult } from './domain/modelGeneration';
import { loadBundledTianwen2Project } from './domain/sampleProject';
import { normalizeProjectExportBundle, type ProjectExportBundle } from './domain/projectExport';
import {
  createWorkbenchProjectState,
  findWorkbenchProjectResource,
  listWorkbenchProjectResources,
  type SavedWorkbenchProjectState,
} from './domain/workbenchProject';
import { createWorkbenchPersistenceClient } from './domain/workbenchPersistence';
import { workbenchEntry } from './domain/workbench';
import { createAgentSidecarClient } from './domain/agentSidecar';
import type { AgentModelingSession, AgentSidecarEvent, AgentSidecarStatus } from './domain/agentSidecar';
const { Header, Sider, Content, Footer } = Layout;
const { TextArea } = Input;
const { Paragraph, Text, Title } = Typography;

const sampleProject = loadBundledTianwen2Project();
const initialSavedProject = createWorkbenchProjectState(sampleProject);
const initialSourceText = sampleProject.sourceMaterials[0]?.content ?? '';
const agentSidecarClient = createAgentSidecarClient();
const workbenchPersistenceClient = createWorkbenchPersistenceClient();
const initialProjectResources = listWorkbenchProjectResources(initialSavedProject);
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
    title: 'SDK Agent 草案与最终模型生成',
    subTitle: '#4',
    content: '当前工作流由 oh-my-pi SDK 管理真实建模 Agent 会话；候选、草案与最终可保存工件都必须来自 Agent，确定性层仅负责校验。',
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
  const [savedProject, setSavedProject] = useState<SavedWorkbenchProjectState>(() => initialSavedProject);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(initialProjectResources[0]?.id ?? null);
  const [projectExport, setProjectExport] = useState<ProjectExportBundle | null>(() => initialSavedProject.lastExportedBundle ?? null);
  const generatedArtifacts = savedProject.generatedArtifacts;
  const [sidecarStatus, setSidecarStatus] = useState<AgentSidecarStatus>(initialSidecarStatus);
  const [agentSession, setAgentSession] = useState<AgentModelingSession | null>(null);
  const [isAgentBusy, setAgentBusy] = useState(false);
  const [isProjectBusy, setProjectBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [liveAgentProgress, setLiveAgentProgress] = useState<AgentSidecarEvent | null>(null);
  const agentRequestToken = useRef(0);
  const isTauriDesktop = hasTauriRuntime();

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

  function applySavedProject(nextProject: SavedWorkbenchProjectState) {
    setSavedProject(nextProject);
    setConfirmedData(nextProject.confirmedData);
    setSourceText(nextProject.sourceMaterials[0]?.content ?? initialSourceText);
    setProjectExport(normalizeProjectExportBundle(nextProject, nextProject.lastExportedBundle ?? null));
    setSelectedResourceId((current) => {
      const nextResources = listWorkbenchProjectResources(nextProject);
      return nextResources.some((resource) => resource.id === current) ? current : (nextResources[0]?.id ?? null);
    });
  }

  const latestAgentProgress = useMemo(() => {
    if (liveAgentProgress?.type === 'progress') {
      return liveAgentProgress;
    }
    if (!agentSession) {
      return null;
    }

    return [...agentSession.events].reverse().find((event) => event.type === 'progress') ?? null;
  }, [agentSession, liveAgentProgress]);

  useEffect(() => {
    if (!isTauriDesktop) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      setProjectBusy(true);
      setProjectError(null);
      try {
        let hydratedProject: SavedWorkbenchProjectState;
        try {
          hydratedProject = await workbenchPersistenceClient.loadProject(sampleProject.manifest.id);
        } catch (error) {
          if (!isMissingProjectError(error)) {
            throw error;
          }
          hydratedProject = await workbenchPersistenceClient.saveProject(initialSavedProject);
        }
        if (!cancelled) {
          applySavedProject(hydratedProject);
        }
      } catch (error) {
        if (!cancelled) {
          setProjectError(error instanceof Error ? error.message : '工作台项目加载失败。');
        }
      } finally {
        if (!cancelled) {
          setProjectBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isTauriDesktop]);
  useEffect(() => {
    if (!isTauriDesktop) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AgentSidecarEvent>('agent-sidecar-event', (event) => {
      if (disposed) {
        return;
      }
      if (event.payload.type === 'progress') {
        setLiveAgentProgress(event.payload);
      }
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
        return;
      }
      unlisten = stopListening;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isTauriDesktop]);

  function isMissingProjectError(error: unknown) {
    return error instanceof Error && error.message.includes('工作台项目状态文件不存在');
  }

  const projectResources = useMemo(
    () =>
      listWorkbenchProjectResources(savedProject).map((resource) => ({
        icon:
          resource.kind === 'SysML v2'
            ? <ApartmentOutlined />
            : resource.kind === '视图模型'
              ? <DatabaseOutlined />
              : resource.kind === 'validation'
                ? <SafetyCertificateOutlined />
                : <FileTextOutlined />,
        id: resource.id,
        label: resource.title,
        kind: resource.kind,
        path: resource.path,
      })),
    [savedProject],
  );

  const selectedProjectResource = useMemo(
    () => (selectedResourceId ? findWorkbenchProjectResource(savedProject, selectedResourceId) : undefined),
    [savedProject, selectedResourceId],
  );

  const resourceTreeData = useMemo(
    () => [
      {
        title: savedProject.manifest.name,
        key: savedProject.manifest.id,
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
    [projectResources, savedProject.manifest.id, savedProject.manifest.name],
  );

  function openImportWizard() {
    setAgentSession(null);
    setConfirmedData(null);
    setLiveAgentProgress(null);
    setAgentError(null);
    setProjectError(null);
    setImportOpen(true);
  }

  async function openBundledSampleProject() {
    setAgentError(null);
    setProjectError(null);
    if (!isTauriDesktop) {
      applySavedProject(initialSavedProject);
      return;
    }

    setProjectBusy(true);
    try {
      let hydratedProject: SavedWorkbenchProjectState;
      try {
        hydratedProject = await workbenchPersistenceClient.loadProject(sampleProject.manifest.id);
      } catch (error) {
        if (!isMissingProjectError(error)) {
          throw error;
        }
        hydratedProject = await workbenchPersistenceClient.saveProject(initialSavedProject);
      }
      setAgentSession(null);
      applySavedProject(hydratedProject);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '内置样例项目加载失败。');
    } finally {
      setProjectBusy(false);
    }
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

  function cancelAgentOperation() {
    agentRequestToken.current += 1;
    setAgentBusy(false);
    setAgentSession(null);
    setConfirmedData(null);
    setAgentError('当前 SDK Agent 任务已取消；如果后台请求稍后返回，其结果会被忽略。');
    void agentSidecarClient.stop().then(setSidecarStatus).catch(() => undefined);
  }

  async function ensureAgentSidecarRunning() {
    if (sidecarStatus.state !== 'running') {
      setSidecarStatus(await agentSidecarClient.start());
    }
  }

  async function extractAgentCandidates() {
    const requestToken = ++agentRequestToken.current;
    setAgentBusy(true);
    setLiveAgentProgress(null);
    setAgentError(null);
    setConfirmedData(null);
    try {
      await ensureAgentSidecarRunning();
      const session = await agentSidecarClient.extractCandidates(sourceText);
      if (requestToken !== agentRequestToken.current) {
        return;
      }
      const extractionEvent = findAgentEvent(session.events, 'extraction');
      if (!extractionEvent) {
        setAgentError('SDK Agent 未返回可确认的抽取结果。');
        setAgentSession(null);
        return;
      }
      setAgentSession(session);
      setConfirmedData(extractionEvent.confirmedData);
    } catch (error) {
      if (requestToken === agentRequestToken.current) {
        setAgentError(error instanceof Error ? error.message : 'Agent 抽取候选失败。');
      }
    } finally {
      if (requestToken === agentRequestToken.current) {
        setLiveAgentProgress(null);
        setAgentBusy(false);
      }
    }
  }

  async function saveAgentGeneratedModel(nextConfirmedData: ConfirmedTianwen2Data, generatedArtifacts: ModelGenerationResult) {
    const provenance = generatedArtifacts.provenance;
    if (
      provenance?.mode !== 'sdk-agent'
      || typeof provenance.provider !== 'string'
      || provenance.provider.trim() === ''
      || typeof provenance.model !== 'string'
      || provenance.model.trim() === ''
      || typeof provenance.sdkSessionId !== 'string'
      || provenance.sdkSessionId.trim() === ''
      || typeof provenance.completedAt !== 'string'
      || provenance.completedAt.trim() === ''
    ) {
      setAgentError('拒绝保存缺少真实 SDK Agent provenance 的模型工件。');
      return false;
    }
    if (generatedArtifacts.viewModel.source !== 'sdk-agent-generated') {
      setAgentError('拒绝保存未声明为 SDK Agent 生成的模型工件。');
      return false;
    }
    const nextProject = createWorkbenchProjectState(sampleProject, {
      confirmedData: nextConfirmedData,
      generatedArtifacts,
      sidecarDraft: generatedArtifacts,
      lastExportedBundle: null,
      projectRoot: savedProject.projectRoot,
      savedAt: savedProject.savedAt,
      sourceText,
    });

    if (!isTauriDesktop) {
      applySavedProject(nextProject);
      return true;
    }

    setProjectBusy(true);
    setProjectError(null);
    try {
      applySavedProject(await workbenchPersistenceClient.saveProject(nextProject));
      return true;
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '工作台项目保存失败。');
      return false;
    } finally {
      setProjectBusy(false);
    }
  }

  async function confirmAgentOutput() {
    const extractionEvent = agentSession ? findAgentEvent(agentSession.events, 'extraction') : undefined;
    const draftEvent = agentSession ? findAgentEvent(agentSession.events, 'model-draft') : undefined;

    if (draftEvent) {
      const nextConfirmedData = confirmedData ?? extractionEvent?.confirmedData;
      if (!nextConfirmedData) {
        setAgentError('Sidecar 输出缺少已确认候选，无法保存 Agent 工件。');
        return;
      }
      if (await saveAgentGeneratedModel(nextConfirmedData, draftEvent.draft)) {
        setAgentSession(null);
        setConfirmedData(null);
        setImportOpen(false);
      }
      return;
    }

    if (!extractionEvent) {
      setAgentError('Sidecar 输出缺少可确认的抽取结果。');
      return;
    }

    const requestToken = ++agentRequestToken.current;
    setAgentBusy(true);
    setLiveAgentProgress(null);
    setAgentError(null);
    try {
      await ensureAgentSidecarRunning();
      const nextSession = await agentSidecarClient.generateDraft(sourceText, confirmedData ?? extractionEvent.confirmedData);
      if (requestToken === agentRequestToken.current) {
        setAgentSession(nextSession);
      }
    } catch (error) {
      if (requestToken === agentRequestToken.current) {
        setAgentError(error instanceof Error ? error.message : 'SDK Agent 最终模型工件生成失败。');
      }
    } finally {
      if (requestToken === agentRequestToken.current) {
        setLiveAgentProgress(null);
        setAgentBusy(false);
      }
    }
  }

  async function exportSavedProject() {
    if (!isTauriDesktop) {
      setProjectError('浏览器预览不支持真实导出；请在 Tauri 桌面壳内执行导出。');
      return;
    }

    setProjectBusy(true);
    setProjectError(null);
    try {
      setProjectExport(await workbenchPersistenceClient.exportProject(savedProject.manifest.id));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '项目导出失败。');
    } finally {
      setProjectBusy(false);
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
                <Title id="workbench-title" level={3} className="brand-title">
                  {workbenchEntry.productName}
                </Title>
              </div>
            </Flex>

            <Card size="small" title="当前项目" className="sider-card">
              <Button block type="primary" size="large" className="project-open-button" onClick={openBundledSampleProject}>
                <Space orientation="vertical" size={0} align="start">
                  <Text className="project-open-title">{savedProject.manifest.name}</Text>
                  <Text className="project-open-id">{savedProject.manifest.id}</Text>
                </Space>
              </Button>
            </Card>

            <Card
              size="small"
              title="模型浏览器"
              className="sider-card resource-card"
              aria-label="模型工件资源树"
            >
              <Tree
                className="resource-tree"
                defaultExpandAll
                selectedKeys={selectedResourceId ? [selectedResourceId] : []}
                treeData={resourceTreeData}
                onSelect={(keys) => setSelectedResourceId(typeof keys[0] === 'string' ? keys[0] : null)}
              />
            </Card>

            <Alert
              className="runtime-alert"
              icon={<DesktopOutlined />}
              title={isTauriDesktop ? 'Tauri 桌面壳已运行' : '当前运行于浏览器预览'}
              description={
                isTauriDesktop
                  ? '当前工作台运行在 Tauri 桌面壳内，保存、加载与导出都由本地项目仓储边界提供。'
                  : '当前界面运行于浏览器预览；真实保存、加载与导出需要在 Tauri 桌面壳内完成。'
              }
              type={isTauriDesktop ? 'success' : 'info'}
              showIcon
            />
            {projectError ? <Alert className="runtime-alert" type="error" showIcon title={projectError} /> : null}

            <Card size="small" title="Agent Sidecar 状态" className="sider-card sidecar-card">
              <Space orientation="vertical" size={8} className="sidecar-status">
                <Space wrap>
                  <Tag color={sidecarStatus.state === 'running' ? 'success' : sidecarStatus.state === 'error' ? 'error' : 'default'}>
                    {sidecarStatus.state}
                  </Tag>
                  <Text type="secondary">{sidecarStatus.endpoint ?? '未连接本地 Sidecar'}</Text>
                </Space>
                {sidecarStatus.message ? <Text type="secondary">{sidecarStatus.message}</Text> : null}
                {latestAgentProgress ? (
                  <Space orientation="vertical" size={4} className="sidecar-progress-block">
                    <Text type="secondary">{latestAgentProgress.message}</Text>
                    <Progress percent={latestAgentProgress.percent} size="small" />
                  </Space>
                ) : null}
                {agentError ? <Alert type="error" showIcon title={agentError} /> : null}
                <Space wrap>
                  <Button size="small" onClick={startAgentSidecar} loading={isAgentBusy || isProjectBusy}>
                    启动 Agent Sidecar
                  </Button>
                  <Button size="small" onClick={stopAgentSidecar} disabled={isProjectBusy}>
                    停止 Agent Sidecar
                  </Button>
                  {isAgentBusy ? <Button size="small" danger onClick={cancelAgentOperation}>取消当前步骤</Button> : null}
                </Space>
              </Space>
            </Card>
          </Sider>

          <Layout className="workspace-layout">
            <Header className="workspace-header">
              <Flex justify="space-between" align="center" gap={24} wrap="wrap">
                <div>
                  <Text className="section-eyebrow">项目工作区</Text>
                  <Title level={2} className="workspace-title">
                    {savedProject.manifest.name}
                  </Title>
                </div>
                <Space wrap aria-label="项目操作">
                  <Button type="primary" icon={<FolderOpenOutlined />} size="large" onClick={openBundledSampleProject} loading={isProjectBusy}>
                    打开内置天问二号样例项目
                  </Button>
                  <Button size="large" onClick={openImportWizard} disabled={isProjectBusy}>
                    新建项目 / 导入材料
                  </Button>
                </Space>
              </Flex>
            </Header>

            <Content
              className="workspace-content"
              aria-label={generatedArtifacts ? '项目建模工作区' : '项目工作区'}
            >
              {generatedArtifacts ? (
                <WorkbenchStudio
                  artifacts={generatedArtifacts}
                  projectExport={projectExport}
                  selectedResource={selectedProjectResource}
                  onExport={exportSavedProject}
                  isExporting={isProjectBusy}
                  isPersistedProject={isTauriDesktop && Boolean(savedProject.projectRoot)}
                  hasSidecarDraft={Boolean(savedProject.sidecarDraft)}
                />
              ) : (
                <WorkbenchHome
                  savedProject={savedProject}
                  selectedResource={selectedProjectResource}
                  projectExport={projectExport}
                  onOpenSample={openBundledSampleProject}
                  onImport={openImportWizard}
                  onExport={exportSavedProject}
                  isExporting={isProjectBusy}
                  isPersistedProject={isTauriDesktop && Boolean(savedProject.projectRoot)}
                />
              )}
            </Content>

            <Footer className="workspace-footer">
              <Space size={16} separator={<span className="footer-separator" />} wrap>
                <Statistic title="源材料" value={savedProject.sourceMaterials.length} />
                <Statistic title="模型工件" value={savedProject.modelArtifacts.length} />
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
          {isAgentBusy && latestAgentProgress ? (
            <Alert type="info" showIcon title={latestAgentProgress.message} description={`当前进度 ${latestAgentProgress.percent}%`} />
          ) : null}
          {agentSession ? (
            <AgentDraftReview session={agentSession} onConfirm={confirmAgentOutput} onReject={rejectAgentOutput} />
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
                {isAgentBusy ? <Button danger onClick={cancelAgentOperation}>取消当前步骤</Button> : null}
              </Space>
            </>
          )}
        </Space>
      </Modal>
    </ConfigProvider>
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
        title={draftEvent ? 'SDK Agent 最终模型工件（待确认保存）' : 'SDK Agent 候选抽取结果（待确认）'}
        description={
          draftEvent
            ? '当前 Sidecar 返回的是由 oh-my-pi SDK 管理的真实建模 Agent 工件；只有通过确定性校验后才允许保存。'
            : '当前 Sidecar 返回的是由 oh-my-pi SDK 管理的真实建模 Agent 候选；请先确认候选，再生成最终模型工件。'
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
        <Card size="small" title="SDK Agent 最终模型摘要">
          <Descriptions
            bordered
            size="small"
            column={1}
            items={[
              { key: 'provider', label: 'provider', children: draftEvent.draft.provenance?.provider ?? session.provider ?? 'unknown' },
              { key: 'model', label: 'model', children: draftEvent.draft.provenance?.model ?? session.model ?? 'unknown' },
              { key: 'sdkSessionId', label: 'SDK sessionId', children: draftEvent.draft.provenance?.sdkSessionId ?? session.sessionId },
              { key: 'completedAt', label: '完成时间', children: draftEvent.draft.provenance?.completedAt ?? session.completedAt ?? 'unknown' },
              { key: 'sysml', label: 'SysML v2', children: `${draftEvent.draft.sysmlText.length} 字符` },
              { key: 'views', label: '视图模型', children: `${draftEvent.draft.viewModel.views.length} 个视图` },
              { key: 'validation', label: '确定性校验', children: draftEvent.draft.validation.valid ? '通过' : '失败' },
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
        <Alert key={index} type="warning" showIcon title={event.message} />
      ))}
      <Space wrap>
        <Button onClick={onReject}>拒绝当前 Agent 结果</Button>
        <Button type="primary" onClick={onConfirm} disabled={!draftEvent && !extractionEvent}>
          {draftEvent ? '确认 Agent 工件并保存到工作台' : '确认候选并生成最终模型工件'}
        </Button>
      </Space>
    </Space>
  );
}

function WorkbenchHome({
  savedProject,
  selectedResource,
  projectExport,
  onOpenSample,
  onImport,
  onExport,
  isExporting,
  isPersistedProject,
}: {
  savedProject: SavedWorkbenchProjectState;
  selectedResource?: { title: string; kind: string; path: string; mediaType: string; content: string };
  projectExport: ProjectExportBundle | null;
  onOpenSample: () => void | Promise<void>;
  onImport: () => void;
  onExport: () => void | Promise<void>;
  isExporting: boolean;
  isPersistedProject: boolean;
}) {
  return (
    <section className="workbench-home" aria-label="项目工作区首页">
      <div className="studio-layout">
        <Card className="workspace-card studio-canvas-card" title="模型画布" extra={<Tag color="blue">等待确认生成</Tag>}>
          <Paragraph className="lead-copy">{savedProject.manifest.description}</Paragraph>
          <Paragraph>
            中央区域保留给模型画布。当前项目尚未生成可保存的 Agent 模型工件；请从左侧浏览材料，或启动导入确认流程生成需求、结构、活动、追溯与参数约束视图。
          </Paragraph>
          <Space wrap>
            <Button type="primary" onClick={onImport}>
              导入材料并生成模型
            </Button>
            <Button onClick={onOpenSample}>重新加载样例项目</Button>
          </Space>
        </Card>
        <aside className="studio-inspector" aria-label="项目检查器">
          <WorkbenchInspectorPanel title="项目检查器">
            <ProjectOverviewSection savedProject={savedProject} isPersistedProject={isPersistedProject} />
            <ResourcePreviewSection selectedResource={selectedResource} />
            <ProjectExportSection projectExport={projectExport} onExport={onExport} isExporting={isExporting} />
          </WorkbenchInspectorPanel>
        </aside>
      </div>
    </section>
  );
}

function WorkbenchStudio({
  artifacts,
  projectExport,
  selectedResource,
  onExport,
  isExporting,
  isPersistedProject,
  hasSidecarDraft,
}: {
  artifacts: ModelGenerationResult;
  projectExport: ProjectExportBundle | null;
  selectedResource?: { title: string; kind: string; path: string; mediaType: string; content: string };
  onExport: () => void | Promise<void>;
  isExporting: boolean;
  isPersistedProject: boolean;
  hasSidecarDraft: boolean;
}) {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState('requirements');
  const requirementView = artifacts.viewModel.views.find((view) => view.kind === 'requirements');
  const bddView = artifacts.viewModel.views.find((view) => view.kind === 'bdd');
  const ibdView = artifacts.viewModel.views.find((view) => view.kind === 'ibd');
  const activityView = artifacts.viewModel.views.find((view) => view.kind === 'activity');
  const traceabilityMatrixView = artifacts.viewModel.views.find((view) => view.kind === 'traceability-matrix');
  const parameterConstraintsView = artifacts.viewModel.views.find((view) => view.kind === 'parameter-constraints');

  const renderStudioPanel = (content: ReactNode) => (
    <div className="studio-layout">
      <div className="studio-canvas">{content}</div>
      <aside className="studio-inspector" aria-label="模型检查器">
        <WorkbenchInspectorPanel title="模型检查器">
          <ValidationSummarySection artifacts={artifacts} isPersistedProject={isPersistedProject} hasSidecarDraft={hasSidecarDraft} />
          <ResourcePreviewSection selectedResource={selectedResource} />
          <ProjectExportSection projectExport={projectExport} onExport={onExport} isExporting={isExporting} />
        </WorkbenchInspectorPanel>
      </aside>
    </div>
  );

  return (
    <section className="generated-workspace" aria-label="MBSE 建模工作区">
      <Flex className="generated-workspace-header" justify="space-between" align="flex-start" gap={16} wrap="wrap">
        <div>
          <Text className="section-eyebrow">模型工作区</Text>
          <Title level={3} className="generated-workspace-title">
            MBSE 建模工作区
          </Title>
          <Text type="secondary" className="generated-workspace-subtitle">
            {isPersistedProject
              ? '当前工作台展示最近一次已保存的 SDK Agent 模型工件；最终 SysML/JSON 直接来自通过确定性校验的 Agent 结果。'
              : '当前工作台展示浏览器内存中的未保存 Agent 预览；需要在 Tauri 桌面壳内保存后才构成已保存项目。'}
          </Text>
        </div>
        <Space wrap size={8} className="generated-workspace-status" aria-label="模型生成状态">
          <Tag color="blue">已生成 {artifacts.viewModel.views.length} 个视图</Tag>
          <Tag color={artifacts.validation.valid ? 'success' : 'error'}>模型校验{artifacts.validation.valid ? '通过' : '未通过'}</Tag>
          <Tag color={artifacts.validation.errors.length === 0 ? 'success' : 'error'}>错误 {artifacts.validation.errors.length}</Tag>
          <Tag color={artifacts.validation.findings.length === 0 ? 'success' : 'warning'}>发现 {artifacts.validation.findings.length}</Tag>
        </Space>
      </Flex>

      <nav className="generated-workspace-navigation" aria-label="建模工作区视图导航">
        <Tabs
          activeKey={activeWorkspaceTab}
          className="generated-workspace-tabs"
          destroyOnHidden
          items={[
            { key: 'requirements', label: '需求视图', children: renderStudioPanel(renderModelView(requirementView, '需求视图')) },
            { key: 'bdd', label: 'BDD 结构视图', children: renderStudioPanel(renderModelView(bddView, 'BDD 结构视图')) },
            { key: 'activity', label: '活动图', children: renderStudioPanel(renderModelView(activityView, '活动图')) },
            {
              key: 'traceability',
              label: '需求追溯矩阵',
              children: renderStudioPanel(
                traceabilityMatrixView
                  ? <TraceabilityMatrixCard view={traceabilityMatrixView} findings={artifacts.validation.findings} />
                  : renderModelView(undefined, '需求追溯矩阵'),
              ),
            },
            { key: 'ibd', label: 'IBD 内部块图', children: renderStudioPanel(renderModelView(ibdView, 'IBD 内部块图')) },
            {
              key: 'parameters',
              label: '参数约束视图',
              children: renderStudioPanel(
                parameterConstraintsView
                  ? <ParameterConstraintCard view={parameterConstraintsView} />
                  : renderModelView(undefined, '参数约束视图'),
              ),
            },
          ]}
          onChange={setActiveWorkspaceTab}
        />
      </nav>
    </section>
  );
}

function renderModelView(view: GeneratedView | undefined, label: string) {
  return view ? (
    <ModelViewCard view={view} />
  ) : (
    <Alert
      showIcon
      type="warning"
      title={`${label}缺失`}
      description={`已确认模型工件中没有可用于展示的${label}。请重新确认导入数据并生成完整模型工件。`}
    />
  );
}

function WorkbenchInspectorPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="workspace-card inspector-shell-card" title={title}>
      <div className="inspector-shell-body">{children}</div>
    </Card>
  );
}

function ProjectOverviewSection({
  savedProject,
  isPersistedProject,
}: {
  savedProject: SavedWorkbenchProjectState;
  isPersistedProject: boolean;
}) {
  return (
    <section className="inspector-section">
      <Text strong className="inspector-section-title">
        项目概览
      </Text>
      <Descriptions
        bordered
        column={1}
        size="small"
        items={[
          { key: 'id', label: '项目 ID', children: savedProject.manifest.id },
          { key: 'domain', label: '任务域', children: savedProject.manifest.caseName },
          { key: 'boundary', label: '工作区边界', children: savedProject.manifest.workspaceBoundary },
          { key: 'savedAt', label: '最近保存', children: savedProject.savedAt ?? '尚未写入本地工作台仓储' },
          { key: 'persisted', label: '持久化状态', children: isPersistedProject ? '已保存项目' : '浏览器内存预览' },
        ]}
      />
    </section>
  );
}

function ValidationSummarySection({
  artifacts,
  isPersistedProject,
  hasSidecarDraft,
}: {
  artifacts: ModelGenerationResult;
  isPersistedProject: boolean;
  hasSidecarDraft: boolean;
}) {
  return (
    <section className="inspector-section">
      <Text strong className="inspector-section-title">
        模型摘要
      </Text>
      <Descriptions
        bordered
        column={1}
        size="small"
        items={[
          { key: 'schema', label: 'schemaVersion', children: artifacts.viewModel.schemaVersion },
          { key: 'project', label: 'projectId', children: artifacts.viewModel.projectId },
          { key: 'views', label: '视图数量', children: artifacts.viewModel.views.length },
          { key: 'rules', label: '校验规则', children: artifacts.viewModel.validation.checkedRules.join(', ') },
          { key: 'validation', label: '模型校验', children: artifacts.validation.valid ? '通过' : '未通过' },
          { key: 'errors', label: '错误数', children: artifacts.validation.errors.length },
          { key: 'findings', label: '发现数', children: artifacts.validation.findings.length },
          { key: 'origin', label: '工件来源', children: artifacts.provenance ? `${artifacts.provenance.provider}/${artifacts.provenance.model} · ${artifacts.provenance.sdkSessionId}` : (hasSidecarDraft ? 'SDK Agent 工件（缺少 provenance）' : '未知来源') },
          { key: 'completedAt', label: '生成完成', children: artifacts.provenance?.completedAt ?? 'unknown' },
          { key: 'schemaOverride', label: 'schema override', children: artifacts.provenance?.schemaOverridden ? '触发，结果不可保存' : '未触发' },
          { key: 'persisted', label: '持久化状态', children: isPersistedProject ? '已保存项目' : '浏览器内存预览' },
        ]}
      />
    </section>
  );
}

function ResourcePreviewSection({
  selectedResource,
}: {
  selectedResource?: { title: string; kind: string; path: string; mediaType: string; content: string };
}) {
  return (
    <section className="inspector-section">
      <Flex justify="space-between" align="center" gap={8} wrap="wrap">
        <Text strong className="inspector-section-title">
          资源预览
        </Text>
        {selectedResource ? <Tag color="blue">{selectedResource.kind}</Tag> : null}
      </Flex>
      {selectedResource ? (
        <Space orientation="vertical" size={10} className="resource-preview-block">
          <Text strong>{selectedResource.title}</Text>
          <Text type="secondary">{selectedResource.path}</Text>
          <Text code>{selectedResource.mediaType}</Text>
          <pre className="artifact-preview">{selectedResource.content}</pre>
        </Space>
      ) : (
        <Alert type="info" showIcon title="请选择左侧资源以查看内容预览。" />
      )}
    </section>
  );
}

function ProjectExportSection({
  projectExport,
  onExport,
  isExporting,
}: {
  projectExport: ProjectExportBundle | null;
  onExport?: () => void | Promise<void>;
  isExporting?: boolean;
}) {
  const columns = [
    {
      title: '类型',
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
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) => <Tag color={status === 'included' ? 'success' : status === 'ready' ? 'processing' : 'error'}>{status}</Tag>,
    },
  ];

  const rows = projectExport
    ? [
        ...projectExport.checklist.map((item) => ({
          id: item.id,
          kind: '检查项',
          label: item.title,
          status: item.status,
        })),
        ...projectExport.artifacts.map((artifact) => ({
          id: artifact.id,
          kind: artifact.type,
          label: artifact.title,
          status: artifact.status,
        })),
      ]
    : [];

  return (
    <section className="inspector-section" aria-label="项目导出状态">
      <Flex justify="space-between" align="center" gap={8} wrap="wrap">
        <Text strong className="inspector-section-title">
          项目导出
        </Text>
        <Space>
          {projectExport ? <Tag color={projectExport.mode === 'exported' ? 'success' : 'processing'}>{projectExport.mode}</Tag> : null}
          {onExport ? (
            <Button size="small" type="primary" onClick={onExport} loading={isExporting}>
              导出项目
            </Button>
          ) : null}
        </Space>
      </Flex>
      {projectExport ? (
        <>
          <Paragraph>导出状态来自最近一次真实导出结果；不会在未导出时提前生成。</Paragraph>
          {projectExport.outputRoot ? <Paragraph type="secondary">导出目录：{projectExport.outputRoot}</Paragraph> : null}
          {projectExport.exportedAt ? <Paragraph type="secondary">导出时间：{projectExport.exportedAt}</Paragraph> : null}
          <Table className="artifact-table" columns={columns} dataSource={rows} pagination={false} rowKey="id" size="small" />
        </>
      ) : (
        <Alert type="info" showIcon title="尚无导出记录" description="导出属于次级动作；只有成功执行导出后，才会在这里显示最近一次导出状态。" />
      )}
    </section>
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
          <Tag color={column.kind === 'structure' ? 'green' : column.kind === 'behavior' ? 'purple' : column.kind === 'interface' ? 'gold' : 'orange'}>
            {column.kind === 'structure' ? '结构元素' : column.kind === 'behavior' ? '行为元素' : column.kind === 'interface' ? '接口元素' : '约束元素'}
          </Tag>
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
          title="覆盖校验发现未覆盖需求"
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

