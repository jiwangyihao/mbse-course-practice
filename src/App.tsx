import { loadBundledTianwen2Project } from './domain/sampleProject';
import { workbenchEntry } from './domain/workbench';

const sampleProject = loadBundledTianwen2Project();

export default function App() {
  const sysmlArtifact = sampleProject.modelArtifacts.find((artifact) => artifact.kind === 'sysml-v2');
  const viewModelArtifact = sampleProject.modelArtifacts.find(
    (artifact) => artifact.kind === 'json-view-model',
  );

  return (
    <main className="app-shell">
      <section className="hero-card" aria-labelledby="workbench-title">
        <p className="eyebrow">{workbenchEntry.courseName}</p>
        <h1 id="workbench-title">{workbenchEntry.productName}</h1>
        <p className="hero-copy">
          围绕{sampleProject.manifest.caseName}，贯通源材料、项目元数据、SysML v2 文本与 JSON
          视图模型，为后续多视图展示和静态校验建立可验证入口。
        </p>
        <div className="hero-actions" aria-label="工作台入口">
          <a className="primary-action" href="#sample-project">
            打开内置天问二号样例项目
          </a>
          <span className="boundary-note">{workbenchEntry.workspaceBoundary}</span>
        </div>
      </section>

      <section id="sample-project" className="dashboard-grid" aria-label="天问二号样例项目摘要">
        <article className="panel panel-wide">
          <div className="panel-heading">
            <p className="eyebrow">样例项目</p>
            <h2>{sampleProject.manifest.name}</h2>
          </div>
          <p>{sampleProject.manifest.description}</p>
          <dl className="metadata-list">
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

        <article className="panel">
          <p className="eyebrow">源材料</p>
          <h2>{sampleProject.sourceMaterials[0]?.title}</h2>
          <p>{sampleProject.sourceMaterials[0]?.content.slice(0, 142)}...</p>
          <code>{sampleProject.sourceMaterials[0]?.path}</code>
        </article>

        <article className="panel">
          <p className="eyebrow">模型工件</p>
          <h2>最小占位已加载</h2>
          <ul className="artifact-list">
            <li>
              <strong>SysML v2 文本：</strong>
              <code>{sysmlArtifact?.path}</code>
            </li>
            <li>
              <strong>JSON 视图模型：</strong>
              <code>{viewModelArtifact?.path}</code>
            </li>
          </ul>
        </article>

        <article className="panel panel-wide">
          <p className="eyebrow">JSON 视图模型摘要</p>
          <h2>可渲染视图契约</h2>
          <div className="view-summary-grid">
            {sampleProject.viewModelSummary.views.map((view) => (
              <div className="view-summary-card" key={view.id}>
                <span>{view.kind}</span>
                <strong>{view.title}</strong>
                <small>
                  {view.nodeCount} 个节点 / {view.edgeCount} 条关系
                </small>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
