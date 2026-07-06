import { loadBundledTianwen2Project } from './domain/sampleProject';
import { workbenchEntry } from './domain/workbench';

const sampleProject = loadBundledTianwen2Project();

const workspaceModules = ['项目列表', '源材料', '确认向导', '模型工件', '视图入口', '静态校验'];

const viewEntries = [
  ...sampleProject.viewModelSummary.views.map((view) => ({
    ...view,
    status: '可打开',
  })),
  {
    id: 'activity-entry',
    title: '活动图入口',
    kind: 'activity',
    nodeCount: 0,
    edgeCount: 0,
    status: '后续切片',
  },
  {
    id: 'traceability-entry',
    title: '追溯矩阵入口',
    kind: 'traceability',
    nodeCount: 0,
    edgeCount: 0,
    status: '后续切片',
  },
];

export default function App() {
  const sysmlArtifact = sampleProject.modelArtifacts.find((artifact) => artifact.kind === 'sysml-v2');
  const viewModelArtifact = sampleProject.modelArtifacts.find(
    (artifact) => artifact.kind === 'json-view-model',
  );

  return (
    <main className="workbench-shell" aria-labelledby="workbench-title">
      <aside className="workbench-sidebar" aria-label="工作台侧栏">
        <div className="brand-block">
          <span className="app-mark">MBSE</span>
          <div>
            <p className="eyebrow">{workbenchEntry.courseName}</p>
            <h1 id="workbench-title">{workbenchEntry.productName}</h1>
          </div>
        </div>

        <nav className="module-nav" aria-label="工作台模块导航">
          {workspaceModules.map((moduleName) => (
            <a href={`#${moduleName}`} key={moduleName}>
              {moduleName}
            </a>
          ))}
        </nav>

        <section className="runtime-card" aria-label="运行状态">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>Tauri 桌面壳入口</strong>
            <p>本地工作台加载内置天问二号样例项目。</p>
          </div>
        </section>
      </aside>

      <section className="workbench-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">当前工作区</p>
            <h2>课程大实践项目入口</h2>
          </div>
          <span className="boundary-pill">{workbenchEntry.workspaceBoundary}</span>
        </header>

        <section className="workspace-grid" aria-label="工作台内容区">
          <article id="项目列表" className="panel project-list-panel">
            <div className="panel-heading">
              <p className="eyebrow">Project Explorer</p>
              <h2>项目列表</h2>
            </div>
            <button className="project-row selected" type="button" aria-pressed="true">
              <span>
                <strong>{sampleProject.manifest.name}</strong>
                <small>{sampleProject.manifest.caseName}</small>
              </span>
              <span className="tag">已加载</span>
            </button>
            <dl className="metadata-list compact">
              <div>
                <dt>项目 ID</dt>
                <dd>{sampleProject.manifest.id}</dd>
              </div>
              <div>
                <dt>产品边界</dt>
                <dd>{sampleProject.manifest.productBoundary}</dd>
              </div>
              <div>
                <dt>工作区边界</dt>
                <dd>{sampleProject.manifest.workspaceBoundary}</dd>
              </div>
            </dl>
          </article>

          <article id="源材料" className="panel">
            <div className="panel-heading">
              <p className="eyebrow">Input Material</p>
              <h2>源材料</h2>
            </div>
            {sampleProject.sourceMaterials.map((material) => (
              <section className="material-card" key={material.id}>
                <strong>{material.title}</strong>
                <p>{material.content.slice(0, 156)}...</p>
                <code>{material.path}</code>
              </section>
            ))}
          </article>

          <article id="确认向导" className="panel wizard-panel">
            <div className="panel-heading">
              <p className="eyebrow">Confirm Wizard</p>
              <h2>确认向导</h2>
            </div>
            <ol className="step-list">
              <li className="done">导入天问二号材料</li>
              <li className="done">读取项目元数据</li>
              <li>后续切片确认使命、需求、分系统和关系</li>
            </ol>
          </article>

          <article id="模型工件" className="panel artifact-panel">
            <div className="panel-heading">
              <p className="eyebrow">Model Artifacts</p>
              <h2>模型工件</h2>
            </div>
            <ul className="artifact-list">
              <li>
                <span>
                  <strong>SysML v2 文本</strong>
                  <small>最小模型源占位</small>
                </span>
                <code>{sysmlArtifact?.path}</code>
              </li>
              <li>
                <span>
                  <strong>JSON 视图模型</strong>
                  <small>前端渲染契约占位</small>
                </span>
                <code>{viewModelArtifact?.path}</code>
              </li>
            </ul>
          </article>

          <article id="视图入口" className="panel view-entry-panel">
            <div className="panel-heading">
              <p className="eyebrow">View Launcher</p>
              <h2>视图入口</h2>
            </div>
            <div className="view-entry-grid">
              {viewEntries.map((view) => (
                <button
                  className="view-entry-card"
                  disabled={view.status !== '可打开'}
                  key={view.id}
                  type="button"
                >
                  <span>{view.kind}</span>
                  <strong>{view.title}</strong>
                  <small>
                    {view.nodeCount} 个节点 / {view.edgeCount} 条关系 · {view.status}
                  </small>
                </button>
              ))}
            </div>
          </article>

          <article id="静态校验" className="panel validation-panel">
            <div className="panel-heading">
              <p className="eyebrow">Validation</p>
              <h2>静态校验</h2>
            </div>
            <p>
              当前切片确认项目契约与工件位置；后续切片会接入 schema、引用、一致性、覆盖、端口和参数校验。
            </p>
            <span className="tag neutral">契约测试已覆盖</span>
          </article>
        </section>
      </section>
    </main>
  );
}
