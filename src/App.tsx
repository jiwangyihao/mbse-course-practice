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
  Layout,
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
import { loadBundledTianwen2Project } from './domain/sampleProject';
import { workbenchEntry } from './domain/workbench';

const { Header, Sider, Content, Footer } = Layout;
const { Paragraph, Text, Title } = Typography;

const sampleProject = loadBundledTianwen2Project();

const projectResources = [
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
    label: artifact.title,
    kind: artifact.kind === 'sysml-v2' ? 'SysML v2' : 'JSON 视图模型',
    path: artifact.path,
  })),
];

const resourceTreeData = [
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
    title: '候选使命、需求、分系统确认向导',
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
    content: '在真实模型工件生成后进入对应视图，不在 #2 预先实现交互。',
  },
];

export default function App() {
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
              description="当前工作台加载内置天问二号样例项目；具体建模流程由后续切片接入。"
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
                  <Button disabled size="large">
                    新建项目 / 导入材料（#3）
                  </Button>
                </Space>
              </Flex>
            </Header>

            <Content className="workspace-content" aria-label="项目主页工作区">
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}>
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
              </Row>
            </Content>

            <Footer className="workspace-footer">
              <Space size={16} separator={<span className="footer-separator" />} wrap>
                <Statistic title="源材料" value={sampleProject.sourceMaterials.length} />
                <Statistic title="模型工件" value={sampleProject.modelArtifacts.length} />
                <Statistic title="视图模型" value={sampleProject.viewModelSummary.views.length} />
                <Text type="secondary">{workbenchEntry.workspaceBoundary}</Text>
              </Space>
            </Footer>
          </Layout>
        </Layout>
      </main>
    </ConfigProvider>
  );
}
