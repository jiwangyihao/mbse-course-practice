import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FolderOpenOutlined, RocketOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
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
import AgentDraftReviewPanel from './AgentDraftReviewPanel';
import AgentExecutionTrace from './AgentExecutionTrace';
import { type ConfirmedTianwen2Data, type GeneratedView, type ModelGenerationResult } from './domain/modelGeneration';
import { loadBundledTianwen2Project } from './domain/sampleProject';
import { normalizeProjectExportBundle, type ProjectExportBundle } from './domain/projectExport';
import {
  createWorkbenchProjectState,
  findWorkbenchProjectResource,
  listWorkbenchProjectResources,
  normalizeSavedWorkbenchProjectState,
  type SavedWorkbenchProjectState,
} from './domain/workbenchProject';
import { createWorkbenchPersistenceClient } from './domain/workbenchPersistence';
import { workbenchEntry } from './domain/workbench';
import { createAgentSidecarClient, findLatestAgentEvent, type AgentModelingSession, type AgentSidecarStatus } from './domain/agentSidecar';
import { useAgentTraceSessions } from './useAgentTraceSessions';
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

const workspaceTabItems = [
  { key: 'requirements', label: '需求视图' },
  { key: 'bdd', label: 'BDD 结构视图' },
  { key: 'activity', label: '活动图' },
  { key: 'traceability', label: '需求追溯矩阵' },
  { key: 'ibd', label: 'IBD 内部块图' },
  { key: 'parameters', label: '参数约束视图' },
];

export default function App() {
  const [isImportOpen, setImportOpen] = useState(false);
  const [sourceText, setSourceText] = useState(initialSourceText);
  const [confirmedData, setConfirmedData] = useState<ConfirmedTianwen2Data | null>(null);
  const [savedProject, setSavedProject] = useState<SavedWorkbenchProjectState>(() => initialSavedProject);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(initialProjectResources[0]?.id ?? null);
  const [projectExport, setProjectExport] = useState<ProjectExportBundle | null>(() => initialSavedProject.lastExportedBundle ?? null);
  const generatedArtifacts = savedProject.generatedArtifacts;
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState('requirements');
  const [sidecarStatus, setSidecarStatus] = useState<AgentSidecarStatus>(initialSidecarStatus);
  const [isAgentBusy, setAgentBusy] = useState(false);
  const [isProjectBusy, setProjectBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const agentRequestToken = useRef(0);
  const isTauriDesktop = hasTauriRuntime();
  const {
    sessions: agentSessions,
    latestProgress: latestAgentProgress,
    replaceSessions,
    mergeSessions,
    resetSessions,
    discardSessions,
    beginLiveEventCapture,
    endLiveEventCapture,
    waitForListenerReady,
  } = useAgentTraceSessions(isTauriDesktop);
  const hasAgentSessions = agentSessions.length > 0;
  const persistedAgentSessions = savedProject.agentTraceSessions ?? [];

  function applySavedProject(nextProject: SavedWorkbenchProjectState) {
    const normalizedProject = normalizeSavedWorkbenchProjectState(nextProject);
    setSavedProject(normalizedProject);
    setConfirmedData(normalizedProject.confirmedData);
    setSourceText(normalizedProject.sourceMaterials[0]?.content ?? initialSourceText);
    setProjectExport(normalizeProjectExportBundle(normalizedProject, normalizedProject.lastExportedBundle ?? null));
    setSelectedResourceId((current) => {
      const nextResources = listWorkbenchProjectResources(normalizedProject);
      return nextResources.some((resource) => resource.id === current) ? current : (nextResources[0]?.id ?? null);
    });
  }

  useEffect(() => {
    if (!isTauriDesktop) {
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
  }, [isTauriDesktop]);
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

  function isMissingProjectError(error: unknown) {
    return error instanceof Error && error.message.includes('工作台项目状态文件不存在');
  }


  const selectedProjectResource = useMemo(
    () => (selectedResourceId ? findWorkbenchProjectResource(savedProject, selectedResourceId) : undefined),
    [savedProject, selectedResourceId],
  );


  function openImportWizard() {
    resetSessions();
    setConfirmedData(null);
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
      resetSessions();
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
    endLiveEventCapture();
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
    endLiveEventCapture();
    agentRequestToken.current += 1;
    setAgentBusy(false);
    discardSessions();
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
    beginLiveEventCapture();
    setAgentBusy(true);
    resetSessions();
    setAgentError(null);
    setConfirmedData(null);
    try {
      await waitForListenerReady();
      if (requestToken !== agentRequestToken.current) {
        return;
      }
      await ensureAgentSidecarRunning();
      if (requestToken !== agentRequestToken.current) {
        return;
      }
      const session = await agentSidecarClient.extractCandidates(sourceText);
      if (requestToken !== agentRequestToken.current) {
        return;
      }
      replaceSessions(session);
      const extractionEvent = findLatestAgentEvent([session], 'extraction');
      if (!extractionEvent) {
        setAgentError('SDK Agent 未返回可确认的抽取结果。');
        return;
      }
      setConfirmedData(extractionEvent.confirmedData);
    } catch (error) {
      if (requestToken === agentRequestToken.current) {
        setAgentError(error instanceof Error ? error.message : 'Agent 抽取候选失败。');
      }
    } finally {
      if (requestToken === agentRequestToken.current) {
        endLiveEventCapture();
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
    if (generatedArtifacts.viewModel.source !== 'sysml-source-set-derived') {
      setAgentError('拒绝保存未声明为 SysML source set 派生的模型工件。');
      return false;
    }
    let nextProject: SavedWorkbenchProjectState;
    try {
      nextProject = createWorkbenchProjectState(sampleProject, {
        confirmedData: nextConfirmedData,
        generatedArtifacts,
        sidecarDraft: generatedArtifacts,
        agentTraceSessions: agentSessions,
        lastExportedBundle: null,
        projectRoot: savedProject.projectRoot,
        savedAt: savedProject.savedAt,
        sourceText,
      });
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : '工作台项目状态构建失败。');
      return false;
    }

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
    const extractionEvent = findLatestAgentEvent(agentSessions, 'extraction');
    const draftEvent = findLatestAgentEvent(agentSessions, 'model-draft');

    if (draftEvent) {
      const nextConfirmedData = confirmedData ?? extractionEvent?.confirmedData;
      if (!nextConfirmedData) {
        setAgentError('Sidecar 输出缺少已确认候选，无法保存 Agent 工件。');
        return;
      }
      if (await saveAgentGeneratedModel(nextConfirmedData, draftEvent.draft)) {
        resetSessions();
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
    beginLiveEventCapture();
    setAgentBusy(true);
    setAgentError(null);
    try {
      await waitForListenerReady();
      if (requestToken !== agentRequestToken.current) {
        return;
      }
      await ensureAgentSidecarRunning();
      if (requestToken !== agentRequestToken.current) {
        return;
      }
      const nextSession = await agentSidecarClient.generateDraft(sourceText, confirmedData ?? extractionEvent.confirmedData);
      if (requestToken === agentRequestToken.current) {
        mergeSessions(nextSession);
      }
    } catch (error) {
      if (requestToken === agentRequestToken.current) {
        setAgentError(error instanceof Error ? error.message : 'SDK Agent 最终模型工件生成失败。');
      }
    } finally {
      if (requestToken === agentRequestToken.current) {
        endLiveEventCapture();
        setAgentBusy(false);
      }
    }
  }

  const exportSavedProject = useCallback(async () => {
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
  }, [isTauriDesktop, savedProject.manifest.id]);

  function rejectAgentOutput() {
    resetSessions();
    setConfirmedData(null);
  }
  const reviewExtractionEvent = findLatestAgentEvent(agentSessions, 'extraction');
  const reviewDraftEvent = findLatestAgentEvent(agentSessions, 'model-draft');

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
          <Sider className="project-sider" width={360} theme="light" aria-label="项目侧栏">
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
                <div className="workspace-header-summary">
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
              {generatedArtifacts ? (
                <Flex className="workspace-header-model-row" justify="space-between" align="center" gap={16}>
                  <Space wrap size={8} className="workspace-header-status" aria-label="模型生成状态">
                    <Tag color="blue">已生成 {generatedArtifacts.viewModel.views.length} 个视图</Tag>
                    <Tag color={generatedArtifacts.validation.valid ? 'success' : 'error'}>
                      模型校验{generatedArtifacts.validation.valid ? '通过' : '未通过'}
                    </Tag>
                    <Tag color={generatedArtifacts.validation.errors.length === 0 ? 'success' : 'error'}>
                      错误 {generatedArtifacts.validation.errors.length}
                    </Tag>
                    <Tag color={generatedArtifacts.validation.findings.length === 0 ? 'success' : 'warning'}>
                      发现 {generatedArtifacts.validation.findings.length}
                    </Tag>
                  </Space>
                  <nav className="workspace-header-navigation" aria-label="建模工作区视图导航">
                    <Tabs
                      activeKey={activeWorkspaceTab}
                      className="workspace-header-tabs"
                      items={workspaceTabItems}
                      onChange={setActiveWorkspaceTab}
                    />
                  </nav>
                </Flex>
              ) : null}
            </Header>

            <Content
              className={generatedArtifacts ? 'workspace-content workspace-content-generated' : 'workspace-content'}
              aria-label={generatedArtifacts ? '项目建模工作区' : '项目工作区'}
            >
              {generatedArtifacts ? (
                <MemoizedWorkbenchStudio
                  artifacts={generatedArtifacts}
                  activeWorkspaceTab={activeWorkspaceTab}
                  projectExport={projectExport}
                  selectedResource={selectedProjectResource}
                  onExport={exportSavedProject}
                  isExporting={isProjectBusy}
                  isPersistedProject={isTauriDesktop && Boolean(savedProject.projectRoot)}
                  hasSidecarDraft={Boolean(savedProject.sidecarDraft)}
                  persistedAgentSessions={persistedAgentSessions}
                />
              ) : (
                <WorkbenchHome
                  savedProject={savedProject}
                  selectedResource={selectedProjectResource}
                  projectExport={projectExport}
                  onOpenSample={openBundledSampleProject}
                  persistedAgentSessions={persistedAgentSessions}
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
        centered
        className="import-modal"
        classNames={{ body: 'import-modal-body' }}
        onCancel={() => setImportOpen(false)}
        footer={(
          <Flex className="import-modal-actions" justify="flex-end" align="center" gap={8} wrap="wrap">
            {hasAgentSessions ? (
              <>
                <Button danger={isAgentBusy} onClick={isAgentBusy ? cancelAgentOperation : rejectAgentOutput}>
                  {isAgentBusy ? '取消当前步骤' : '拒绝当前 Agent 结果'}
                </Button>
                <Button
                  type="primary"
                  onClick={confirmAgentOutput}
                  disabled={isAgentBusy || (!reviewDraftEvent && !reviewExtractionEvent)}
                >
                  {reviewDraftEvent ? '确认 Agent 工件并保存到工作台' : '确认候选并生成最终模型工件'}
                </Button>
              </>
            ) : (
              <>
                {isAgentBusy ? <Button danger onClick={cancelAgentOperation}>取消当前步骤</Button> : null}
                <Button type="primary" onClick={extractAgentCandidates} loading={isAgentBusy}>
                  抽取候选
                </Button>
              </>
            )}
          </Flex>
        )}
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
          {hasAgentSessions ? (
            <AgentDraftReviewPanel sessions={agentSessions} busy={isAgentBusy} />
          ) : (
            <>
              <TextArea
                aria-label="源材料粘贴内容"
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                rows={7}
              />
            </>
          )}
        </Space>
      </Modal>
    </ConfigProvider>
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
  persistedAgentSessions,
}: {
  savedProject: SavedWorkbenchProjectState;
  selectedResource?: { title: string; kind: string; path: string; mediaType: string; content: string };
  projectExport: ProjectExportBundle | null;
  onOpenSample: () => void | Promise<void>;
  onImport: () => void;
  onExport: () => void | Promise<void>;
  isExporting: boolean;
  isPersistedProject: boolean;
  persistedAgentSessions: AgentModelingSession[];
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
            <AgentTraceSection sessions={persistedAgentSessions} />
          </WorkbenchInspectorPanel>
        </aside>
      </div>
    </section>
  );
}

function WorkbenchStudio({
  artifacts,
  activeWorkspaceTab,
  projectExport,
  selectedResource,
  onExport,
  isExporting,
  isPersistedProject,
  hasSidecarDraft,
  persistedAgentSessions,
}: {
  activeWorkspaceTab: string;
  artifacts: ModelGenerationResult;
  projectExport: ProjectExportBundle | null;
  selectedResource?: { title: string; kind: string; path: string; mediaType: string; content: string };
  onExport: () => void | Promise<void>;
  isExporting: boolean;
  isPersistedProject: boolean;
  hasSidecarDraft: boolean;
  persistedAgentSessions: AgentModelingSession[];
}) {
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
          <AgentTraceSection sessions={persistedAgentSessions} />
        </WorkbenchInspectorPanel>
      </aside>
    </div>
  );

  function renderWorkspaceView(tabKey: string) {
    switch (tabKey) {
      case 'bdd':
        return renderModelView(bddView, 'BDD 结构视图');
      case 'activity':
        return renderModelView(activityView, '活动图');
      case 'traceability':
        return traceabilityMatrixView
          ? <TraceabilityMatrixCard view={traceabilityMatrixView} findings={artifacts.validation.findings} />
          : renderModelView(undefined, '需求追溯矩阵');
      case 'ibd':
        return renderModelView(ibdView, 'IBD 内部块图');
      case 'parameters':
        return parameterConstraintsView
          ? <ParameterConstraintCard view={parameterConstraintsView} />
          : renderModelView(undefined, '参数约束视图');
      default:
        return renderModelView(requirementView, '需求视图');
    }
  }

  const activeWorkspaceTabLabel = workspaceTabItems.find((item) => item.key === activeWorkspaceTab)?.label ?? '模型视图';

  return (
    <section className="generated-workspace" aria-label="MBSE 建模工作区">
      <div className="workspace-active-tab-panel" role="tabpanel" aria-label={activeWorkspaceTabLabel}>
        {renderStudioPanel(renderWorkspaceView(activeWorkspaceTab))}
      </div>
    </section>
  );
}

const MemoizedWorkbenchStudio = memo(WorkbenchStudio);

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

function AgentTraceSection({ sessions }: { sessions: AgentModelingSession[] }) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <section className="inspector-section" aria-label="已保存的 Agent 执行轨迹">
      <Collapse
        size="small"
        items={[{
          key: 'saved-agent-trace',
          label: '已保存的 Agent 执行轨迹',
          children: <AgentExecutionTrace sessions={sessions} busy={false} embedded />,
        }]}
      />
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


function isSameSidecarStatus(left: AgentSidecarStatus, right: AgentSidecarStatus) {
  return left.state === right.state && left.pid === right.pid && left.endpoint === right.endpoint && left.message === right.message;
}

function hasTauriRuntime() {
  return typeof window !== 'undefined' && Boolean((window as TauriRuntimeWindow).__TAURI_INTERNALS__);
}

