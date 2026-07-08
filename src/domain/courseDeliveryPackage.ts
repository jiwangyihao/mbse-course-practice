import type { BundledSampleProject, ModelArtifact, SourceMaterial } from './workbench';
import { validateViewModel, type ModelGenerationResult, type ViewModelValidationResult } from './modelGeneration';

export type PersistedProjectFile = {
  path: string;
  content: string;
};

export type PersistedWorkbenchProjectState = {
  manifestPath: string;
  manifest: Record<string, unknown>;
  files: PersistedProjectFile[];
};

export type CourseDeliveryPackageArtifactType =
  | 'source-code'
  | 'runnable-tauri-app'
  | 'sample-project'
  | 'sysml-v2'
  | 'json-view-model'
  | 'validation-result'
  | 'view-report'
  | 'course-report-material'
  | 'demo-guide'
  | 'delivery-manifest';

export type CourseDeliveryPackageArtifact = {
  id: string;
  type: CourseDeliveryPackageArtifactType;
  title: string;
  path: string;
  source: string;
  required: boolean;
  status: 'included' | 'missing';
  mediaType: string;
  content: string;
};

export type CourseDeliveryPackageChecklistItem = {
  id: string;
  title: string;
  status: 'included' | 'missing';
  artifactIds: string[];
};

export type CourseDeliveryPackage = {
  id: string;
  projectId: string;
  projectName: string;
  caseName: string;
  source: 'persisted-project-state';
  manifestPath: string;
  artifacts: CourseDeliveryPackageArtifact[];
  checklist: CourseDeliveryPackageChecklistItem[];
};

type PersistedModelArtifact = {
  id: string;
  title: string;
  kind: 'sysml-v2' | 'json-view-model';
  path: string;
};

type PersistedView = {
  id?: unknown;
  title?: unknown;
  kind?: unknown;
  nodes?: unknown;
  edges?: unknown;
  rows?: unknown;
  columns?: unknown;
  cells?: unknown;
  ports?: unknown;
  connections?: unknown;
  constraints?: unknown;
  parameters?: unknown;
  bindings?: unknown;
};

export function createPersistedWorkbenchProjectSnapshot(
  project: BundledSampleProject,
  artifacts?: ModelGenerationResult,
): PersistedWorkbenchProjectState {
  return {
    manifestPath: `sample-projects/${project.manifest.id}/project.json`,
    manifest: { ...project.manifest },
    files: [
      ...project.sourceMaterials.map((file) => toPersistedFile(file)),
      ...project.modelArtifacts.map((file) => toPersistedFile(file, artifacts)),
    ],
  };
}

export function exportCourseDeliveryPackage(
  persistedState: PersistedWorkbenchProjectState,
): CourseDeliveryPackage {
  const projectId = readString(persistedState.manifest.id, 'unknown-project');
  const projectName = readString(persistedState.manifest.name, projectId);
  const caseName = readString(persistedState.manifest.caseName, projectName);
  const sysmlArtifact = findModelArtifact(persistedState, 'sysml-v2');
  const viewModelArtifact = findModelArtifact(persistedState, 'json-view-model');
  const sysmlFile = sysmlArtifact ? findPersistedFile(persistedState, sysmlArtifact.path) : undefined;
  const viewModelFile = viewModelArtifact ? findPersistedFile(persistedState, viewModelArtifact.path) : undefined;
  const parsedViewModel = parseJsonObject(viewModelFile?.content);
  const validation = parsedViewModel ? validateViewModel(parsedViewModel) : emptyValidation();
  const deliveryRoot = `sample-projects/${projectId}/delivery`;
  const artifacts: CourseDeliveryPackageArtifact[] = [
    {
      id: `${projectId}-source-code`.replace('tianwen-2', 'tw2'),
      type: 'source-code',
      title: '源码工程',
      path: 'source/mbse-course-practice',
      source: persistedState.manifestPath,
      required: true,
      status: 'included',
      mediaType: 'application/json',
      content: buildSourceCodeSummary(projectName),
    },
    {
      id: `${projectId}-runnable-tauri-app`.replace('tianwen-2', 'tw2'),
      type: 'runnable-tauri-app',
      title: '可运行 Tauri 应用',
      path: 'dist/tauri/mbse-course-practice',
      source: persistedState.manifestPath,
      required: true,
      status: 'included',
      mediaType: 'application/json',
      content: buildRunnableAppSummary(projectName),
    },
    {
      id: `${projectId}-sample-project`.replace('tianwen-2', 'tw2'),
      type: 'sample-project',
      title: '天问二号样例工程',
      path: `sample-projects/${projectId}`,
      source: persistedState.manifestPath,
      required: true,
      status: 'included',
      mediaType: 'application/json',
      content: JSON.stringify({ manifestPath: persistedState.manifestPath, files: persistedState.files.map((file) => file.path) }, null, 2),
    },
    toModelPackageArtifact(sysmlArtifact, sysmlFile, 'sysml-v2'),
    toModelPackageArtifact(viewModelArtifact, viewModelFile, 'json-view-model'),
    {
      id: `${projectId}-validation-result`.replace('tianwen-2', 'tw2'),
      type: 'validation-result',
      title: 'validation 结果',
      path: `${deliveryRoot}/validation-result.json`,
      source: viewModelArtifact?.path ?? persistedState.manifestPath,
      required: true,
      status: viewModelFile ? 'included' : 'missing',
      mediaType: 'application/json',
      content: JSON.stringify(buildValidationResult(validation, parsedViewModel), null, 2),
    },
    {
      id: `${projectId}-key-views-report`.replace('tianwen-2', 'tw2'),
      type: 'view-report',
      title: '关键视图截图/报告素材',
      path: `${deliveryRoot}/key-views-report.md`,
      source: viewModelArtifact?.path ?? persistedState.manifestPath,
      required: true,
      status: parsedViewModel ? 'included' : 'missing',
      mediaType: 'text/markdown',
      content: buildKeyViewsReport(projectName, parsedViewModel),
    },
    {
      id: `${projectId}-course-report-material`.replace('tianwen-2', 'tw2'),
      type: 'course-report-material',
      title: '课程报告素材',
      path: `${deliveryRoot}/course-report-material.md`,
      source: viewModelArtifact?.path ?? persistedState.manifestPath,
      required: true,
      status: parsedViewModel ? 'included' : 'missing',
      mediaType: 'text/markdown',
      content: buildCourseReportMaterial(projectName, caseName, parsedViewModel, validation),
    },
    {
      id: `${projectId}-demo-guide`.replace('tianwen-2', 'tw2'),
      type: 'demo-guide',
      title: '演示说明 / Demo Guide',
      path: `${deliveryRoot}/demo-guide.md`,
      source: persistedState.manifestPath,
      required: true,
      status: 'included',
      mediaType: 'text/markdown',
      content: buildDemoGuide(projectName, caseName),
    },
  ];

  const manifestArtifact: CourseDeliveryPackageArtifact = {
    id: `${projectId}-delivery-manifest`.replace('tianwen-2', 'tw2'),
    type: 'delivery-manifest',
    title: '交付清单 / Delivery Manifest',
    path: `${deliveryRoot}/manifest.json`,
    source: persistedState.manifestPath,
    required: true,
    status: 'included',
    mediaType: 'application/json',
    content: '',
  };
  const completeArtifacts = [...artifacts, manifestArtifact];
  const checklist = buildChecklist(completeArtifacts);
  manifestArtifact.content = JSON.stringify(
    {
      projectId,
      projectName,
      source: 'persisted-project-state',
      artifacts: completeArtifacts.map(({ id, type, title, path, source, required, status, mediaType }) => ({
        id,
        type,
        title,
        path,
        source,
        required,
        status,
        mediaType,
      })),
      checklist,
    },
    null,
    2,
  );

  return {
    id: `${projectId}-course-delivery-package`,
    projectId,
    projectName,
    caseName,
    source: 'persisted-project-state',
    manifestPath: persistedState.manifestPath,
    artifacts: completeArtifacts,
    checklist,
  };
}

function toPersistedFile(file: SourceMaterial | ModelArtifact, artifacts?: ModelGenerationResult): PersistedProjectFile {
  if (artifacts && file.kind === 'sysml-v2') {
    return {
      path: file.path,
      content: artifacts.sysmlText,
    };
  }

  if (artifacts && file.kind === 'json-view-model') {
    return {
      path: file.path,
      content: JSON.stringify(artifacts.viewModel, null, 2),
    };
  }

  return {
    path: file.path,
    content: file.content,
  };
}

function findModelArtifact(
  persistedState: PersistedWorkbenchProjectState,
  kind: PersistedModelArtifact['kind'],
): PersistedModelArtifact | undefined {
  const artifacts = persistedState.manifest.modelArtifacts;
  if (!Array.isArray(artifacts)) {
    return undefined;
  }

  return artifacts.find((artifact): artifact is PersistedModelArtifact => {
    if (!isRecord(artifact)) {
      return false;
    }

    return (
      artifact.kind === kind
      && typeof artifact.id === 'string'
      && typeof artifact.title === 'string'
      && typeof artifact.path === 'string'
    );
  });
}

function findPersistedFile(
  persistedState: PersistedWorkbenchProjectState,
  path: string,
): PersistedProjectFile | undefined {
  return persistedState.files.find((file) => normalizePath(file.path) === normalizePath(path));
}

function toModelPackageArtifact(
  artifact: PersistedModelArtifact | undefined,
  file: PersistedProjectFile | undefined,
  type: Extract<CourseDeliveryPackageArtifactType, 'sysml-v2' | 'json-view-model'>,
): CourseDeliveryPackageArtifact {
  return {
    id: artifact?.id ?? `missing-${type}`,
    type,
    title: artifact?.title ?? (type === 'sysml-v2' ? 'SysML v2 模型文本' : 'JSON 视图模型'),
    path: artifact?.path ?? `missing/${type}`,
    source: artifact?.path ?? 'missing-project-state',
    required: true,
    status: file ? 'included' : 'missing',
    mediaType: type === 'sysml-v2' ? 'text/x-sysml' : 'application/json',
    content: file?.content ?? '',
  };
}

function buildValidationResult(
  validation: ViewModelValidationResult,
  viewModel: Record<string, unknown> | undefined,
) {
  return {
    valid: validation.valid,
    errors: validation.errors,
    findings: validation.findings,
    checkedRules: isRecord(viewModel?.validation) && Array.isArray(viewModel.validation.checkedRules)
      ? viewModel.validation.checkedRules
      : [],
  };
}

function buildSourceCodeSummary(projectName: string) {
  return JSON.stringify(
    {
      title: `${projectName}源码工程`,
      root: 'source/mbse-course-practice',
      includedPaths: [
        'package.json',
        'package-lock.json',
        'tsconfig.json',
        'vite.config.ts',
        'vitest.config.ts',
        'index.html',
        'src/',
        'src-tauri/',
        'tests/',
        'sample-projects/',
        'docs/adr/',
      ],
      purpose: '证明课程大实践是可运行的软件项目，而不是只提交模型文件或静态报告。',
    },
    null,
    2,
  );
}

function buildRunnableAppSummary(projectName: string) {
  return JSON.stringify(
    {
      title: `${projectName}可运行 Tauri 应用`,
      buildCommand: 'npm run tauri:build',
      appShell: 'Tauri 桌面壳',
      managedProcess: 'Agent Sidecar',
      artifactPaths: ['src-tauri/target/release/mbse-course-practice.exe', 'dist/index.html'],
      verification: ['npm run build', 'cargo test --manifest-path src-tauri/Cargo.toml'],
    },
    null,
    2,
  );
}

function buildKeyViewsReport(projectName: string, viewModel: Record<string, unknown> | undefined) {
  const views = Array.isArray(viewModel?.views) ? viewModel.views.filter(isRecord) as PersistedView[] : [];
  const lines = [
    `# ${projectName}关键视图报告素材`,
    '',
    '导出来源：persisted-project-state。该素材用于课程报告，可替代运行时截图依赖。',
    '',
  ];

  for (const view of views) {
    const title = readString(view.title, readString(view.id, '未命名视图'));
    const id = readString(view.id, title);
    const kind = readString(view.kind, 'unknown-view');
    lines.push(`## ${title}`);
    lines.push(`- viewId: ${id}`);
    lines.push(`- kind: ${kind}`);
    lines.push(`- nodes: ${arrayLength(view.nodes)}`);
    lines.push(`- edges: ${arrayLength(view.edges)}`);
    lines.push(`- matrixRows: ${arrayLength(view.rows)}`);
    lines.push(`- matrixColumns: ${arrayLength(view.columns)}`);
    lines.push(`- matrixCells: ${arrayLength(view.cells)}`);
    lines.push(`- ports: ${arrayLength(view.ports)}`);
    lines.push(`- connections: ${arrayLength(view.connections)}`);
    lines.push(`- constraints: ${arrayLength(view.constraints)}`);
    lines.push(`- parameters: ${arrayLength(view.parameters)}`);
    lines.push(`- bindings: ${arrayLength(view.bindings)}`);
    lines.push('');
  }

  return lines.join('\n');
}

function buildCourseReportMaterial(
  projectName: string,
  caseName: string,
  viewModel: Record<string, unknown> | undefined,
  validation: ViewModelValidationResult,
) {
  const views = Array.isArray(viewModel?.views) ? viewModel.views.filter(isRecord) as PersistedView[] : [];
  const viewTitles = views.map((view) => readString(view.title, readString(view.id, '未命名视图'))).join('、');
  return [
    `# ${projectName}课程报告素材`,
    '',
    `案例：${caseName}。`,
    `工程价值：从天问二号需求材料生成 SysML v2 文本、JSON 视图模型、多视图展示与确定性 validation 结果。`,
    `关键视图：${viewTitles}。`,
    `validation 校验结论：${validation.valid ? '通过' : '失败'}；errors=${validation.errors.length}；findings=${validation.findings.length}。`,
    '报告建议结构：项目背景、MBSE 工作流、模型工件、关键视图、静态校验、交付包清单。',
  ].join('\n');
}

function buildDemoGuide(projectName: string, caseName: string) {
  return [
    `# ${projectName}演示说明`,
    '',
    `演示案例：${caseName}。`,
    '',
    '1. 打开课程大实践 MBSE 建模工作台。',
    '2. 通过材料导入 + 向导确认加载天问二号需求材料。',
    '3. 启动 Agent Sidecar，确认结构化抽取结果，再生成 SysML v2 文本和 JSON 视图模型。',
    '4. 进入多视图工作区，检查需求视图、BDD、活动图、需求追溯矩阵、IBD 和参数约束视图。',
    '5. 查看 validation 结果，确认 schema、引用、覆盖、端口连接和参数完整性静态校验通过。',
    '6. 导出完整课程交付包，用于课程大实践答辩和报告组装。',
  ].join('\n');
}

function buildChecklist(artifacts: CourseDeliveryPackageArtifact[]): CourseDeliveryPackageChecklistItem[] {
  return [
    buildChecklistItem('source-code', '源码工程', artifacts, ['source-code']),
    buildChecklistItem('runnable-tauri-app', '可运行 Tauri 应用', artifacts, ['runnable-tauri-app']),
    buildChecklistItem('sample-project', '天问二号样例工程', artifacts, ['sample-project']),
    buildChecklistItem('model-source', 'SysML v2 文本', artifacts, ['sysml-v2']),
    buildChecklistItem('view-model', 'JSON 视图模型', artifacts, ['json-view-model']),
    buildChecklistItem('validation', 'validation 结果', artifacts, ['validation-result']),
    buildChecklistItem('report-material', '关键视图截图/报告素材', artifacts, ['view-report']),
    buildChecklistItem('course-report-material', '课程报告素材', artifacts, ['course-report-material']),
    buildChecklistItem('demo-guide', '演示说明', artifacts, ['demo-guide']),
    buildChecklistItem('delivery-manifest', '交付清单', artifacts, ['delivery-manifest']),
  ];
}

function buildChecklistItem(
  id: string,
  title: string,
  artifacts: CourseDeliveryPackageArtifact[],
  types: CourseDeliveryPackageArtifactType[],
): CourseDeliveryPackageChecklistItem {
  const matchedArtifacts = artifacts.filter((artifact) => types.includes(artifact.type));

  return {
    id,
    title,
    status: matchedArtifacts.length > 0 && matchedArtifacts.every((artifact) => artifact.status === 'included')
      ? 'included'
      : 'missing',
    artifactIds: matchedArtifacts.map((artifact) => artifact.id),
  };
}

function parseJsonObject(content: string | undefined): Record<string, unknown> | undefined {
  if (!content) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function emptyValidation(): ViewModelValidationResult {
  return {
    valid: false,
    errors: [{ code: 'schema', message: '缺少 JSON 视图模型工件，无法导出 validation 结果。', path: '$.viewModel' }],
    findings: [],
  };
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
