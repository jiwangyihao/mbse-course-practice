import { validateViewModel, type ViewModelValidationResult } from './modelGeneration';
import type { SavedWorkbenchProjectState } from './workbenchProject';
import { validationArtifactPath } from './workbenchProject';

export type ProjectExportArtifactType =
  | 'source-code'
  | 'desktop-app'
  | 'saved-project'
  | 'sysml-v2'
  | 'json-view-model'
  | 'validation-result'
  | 'export-manifest';

export type ProjectExportArtifactStatus = 'ready' | 'included' | 'missing';

export type ProjectExportArtifact = {
  id: string;
  type: ProjectExportArtifactType;
  title: string;
  path: string;
  source: string;
  required: boolean;
  status: ProjectExportArtifactStatus;
  mediaType: string;
  content: string;
  detail?: string;
};

export type ProjectExportChecklistItem = {
  id: string;
  title: string;
  status: ProjectExportArtifactStatus;
  artifactIds: string[];
};

export type ProjectExportBundle = {
  id: string;
  projectId: string;
  projectName: string;
  source: 'persisted-project-state';
  mode: 'planned' | 'exported';
  manifestPath: string;
  outputRoot: string | null;
  exportedAt: string | null;
  artifacts: ProjectExportArtifact[];
  checklist: ProjectExportChecklistItem[];
};

const LEGACY_ARTIFACT_TYPE_MAP = {
  'source-code': 'source-code',
  'runnable-tauri-app': 'desktop-app',
  'desktop-app': 'desktop-app',
  'sample-project': 'saved-project',
  'saved-project': 'saved-project',
  'sysml-v2': 'sysml-v2',
  'json-view-model': 'json-view-model',
  'validation-result': 'validation-result',
  'delivery-manifest': 'export-manifest',
  'export-manifest': 'export-manifest',
} satisfies Record<string, ProjectExportArtifactType>;

const SUPPORTED_EXPORT_ARTIFACT_TYPES = new Set<ProjectExportArtifactType>([
  'source-code',
  'desktop-app',
  'saved-project',
  'sysml-v2',
  'json-view-model',
  'validation-result',
  'export-manifest',
]);

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

export function buildProjectExportBundle(savedProject: SavedWorkbenchProjectState): ProjectExportBundle {
  const projectId = readString(savedProject.manifest.id, 'unknown-project');
  const projectName = readString(savedProject.manifest.name, projectId);
  const sysmlArtifacts = savedProject.modelArtifacts.filter((artifact) => artifact.kind === 'sysml-v2');
  const viewModelArtifact = savedProject.modelArtifacts.find((artifact) => artifact.kind === 'json-view-model');
  const sysmlExportArtifacts: ProjectExportArtifact[] = sysmlArtifacts.map((artifact, index) => {
    const sysmlFile = findPersistedFile(savedProject, artifact.path);
    const relativeModelPath = artifact.path.replace(/^sample-projects\/[^/]+\/model\//, '');
    return {
      id: artifact.id || `${projectId}-sysml-${index}`,
      type: 'sysml-v2',
      title: artifact.title || `SysML v2 源文件 ${relativeModelPath}`,
      path: `model/${relativeModelPath}`,
      source: artifact.path,
      required: true,
      status: sysmlFile ? 'ready' : 'missing',
      mediaType: 'text/x-sysml',
      content: sysmlFile?.content ?? '',
      detail: sysmlFile ? undefined : `已保存项目中缺少 SysML v2 源文件：${relativeModelPath}。`,
    };
  });
  const viewModelFile = viewModelArtifact ? findPersistedFile(savedProject, viewModelArtifact.path) : undefined;
  const savedValidationFile = findPersistedFile(savedProject, validationArtifactPath(projectId));
  const parsedViewModel = parseJsonObject(viewModelFile?.content);
  const validation = parsedViewModel ? validateViewModel(parsedViewModel) : emptyValidation();
  const artifacts: ProjectExportArtifact[] = [
    {
      id: `${projectId}-source-code`.replace('tianwen-2', 'tw2'),
      type: 'source-code',
      title: '源码工程',
      path: 'source/mbse-workbench',
      source: savedProject.projectRoot ?? savedProject.manifestPath,
      required: true,
      status: 'missing',
      mediaType: 'application/json',
      content: buildSourceCodeSummary(projectName),
      detail: '等待导出命令实际复制源码工程后才会标记为 included。',
    },
    {
      id: `${projectId}-desktop-app`.replace('tianwen-2', 'tw2'),
      type: 'desktop-app',
      title: '桌面应用',
      path: 'runnable/mbse-workbench.exe',
      source: savedProject.projectRoot ?? savedProject.manifestPath,
      required: true,
      status: 'missing',
      mediaType: 'application/json',
      content: buildDesktopAppSummary(projectName),
      detail: '等待导出命令实际复制桌面应用后才会标记为 included。',
    },
    {
      id: `${projectId}-saved-project`.replace('tianwen-2', 'tw2'),
      type: 'saved-project',
      title: '已保存项目快照',
      path: `project/${projectId}`,
      source: savedProject.manifestPath,
      required: true,
      status: 'ready',
      mediaType: 'application/json',
      content: JSON.stringify(
        {
          manifestPath: savedProject.manifestPath,
          files: savedProject.files.map((file) => ({ path: file.path, mediaType: file.mediaType })),
        },
        null,
        2,
      ),
    },
    ...sysmlExportArtifacts,
    {
      id: viewModelArtifact?.id ?? `missing-${projectId}-json-view-model`,
      type: 'json-view-model',
      title: viewModelArtifact?.title ?? 'JSON 视图模型',
      path: 'model/view-model.json',
      source: viewModelArtifact?.path ?? savedProject.manifestPath,
      required: true,
      status: viewModelFile ? 'ready' : 'missing',
      mediaType: 'application/json',
      content: viewModelFile?.content ?? '',
      detail: viewModelFile ? undefined : '已保存项目中缺少 JSON 视图模型。',
    },
    {
      id: `${projectId}-validation-result`.replace('tianwen-2', 'tw2'),
      type: 'validation-result',
      title: 'validation 结果',
      path: 'model/validation-result.json',
      source: savedValidationFile?.path ?? viewModelArtifact?.path ?? savedProject.manifestPath,
      required: true,
      status: parsedViewModel ? 'ready' : 'missing',
      mediaType: 'application/json',
      content: JSON.stringify(buildValidationResult(validation, parsedViewModel), null, 2),
      detail: parsedViewModel ? undefined : '缺少可校验的 JSON 视图模型，无法生成 validation 结果。',
    },
  ];
  const manifestArtifact: ProjectExportArtifact = {
    id: `${projectId}-export-manifest`.replace('tianwen-2', 'tw2'),
    type: 'export-manifest',
    title: '导出清单',
    path: 'export/manifest.json',
    source: savedProject.manifestPath,
    required: true,
    status: 'ready',
    mediaType: 'application/json',
    content: '',
  };
  const completeArtifacts = [...artifacts, manifestArtifact];
  const checklist = buildChecklist(completeArtifacts);
  const bundle: ProjectExportBundle = {
    id: `${projectId}-project-export`,
    projectId,
    projectName,
    source: 'persisted-project-state',
    mode: 'planned',
    manifestPath: savedProject.manifestPath,
    outputRoot: null,
    exportedAt: null,
    artifacts: completeArtifacts,
    checklist,
  };
  manifestArtifact.content = buildExportManifest(bundle);
  return bundle;
}

export function markProjectExportBundleExported(
  plannedBundle: ProjectExportBundle,
  outputRoot: string,
  exportedAt: string,
  artifacts: Array<Pick<ProjectExportArtifact, 'id' | 'status' | 'detail'>>,
): ProjectExportBundle {
  const statusById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const nextArtifacts = plannedBundle.artifacts.map((artifact) => {
    const exported = statusById.get(artifact.id);
    return exported
      ? {
          ...artifact,
          status: exported.status,
          detail: exported.detail,
        }
      : artifact;
  });

  const bundle: ProjectExportBundle = {
    ...plannedBundle,
    mode: 'exported',
    outputRoot,
    exportedAt,
    artifacts: nextArtifacts,
    checklist: buildChecklist(nextArtifacts),
  };
  const manifestArtifact = bundle.artifacts.find((artifact) => artifact.type === 'export-manifest');
  if (manifestArtifact) {
    manifestArtifact.content = buildExportManifest(bundle);
  }
  return bundle;
}

export function normalizeProjectExportBundle(
  savedProject: SavedWorkbenchProjectState,
  bundle: ProjectExportBundle | null | undefined,
): ProjectExportBundle | null {
  if (!bundle) {
    return null;
  }

  const artifacts = Array.isArray(bundle.artifacts) ? bundle.artifacts : [];
  const requiresMigration = artifacts.some((artifact) => normalizeLegacyArtifactType(artifact.type) === undefined || isLegacyOnlyArtifactType(artifact.type));
  if (!requiresMigration) {
    return bundle;
  }

  const plannedBundle = buildProjectExportBundle(savedProject);
  const legacyByType = new Map<ProjectExportArtifactType, typeof artifacts[number]>();
  for (const artifact of artifacts) {
    const normalizedType = normalizeLegacyArtifactType(artifact.type);
    if (!normalizedType || legacyByType.has(normalizedType)) {
      continue;
    }
    legacyByType.set(normalizedType, artifact);
  }

  const nextArtifacts = plannedBundle.artifacts.map((artifact) => {
    const legacyArtifact = legacyByType.get(artifact.type);
    return legacyArtifact
      ? {
          ...artifact,
          status: normalizeArtifactStatus(legacyArtifact.status),
          detail: legacyArtifact.detail,
        }
      : artifact;
  });

  const migratedBundle: ProjectExportBundle = {
    ...plannedBundle,
    mode: bundle.mode === 'exported' ? 'exported' : 'planned',
    outputRoot: typeof bundle.outputRoot === 'string' && bundle.outputRoot.trim() !== '' ? bundle.outputRoot : null,
    exportedAt: typeof bundle.exportedAt === 'string' && bundle.exportedAt.trim() !== '' ? bundle.exportedAt : null,
    artifacts: nextArtifacts,
    checklist: buildChecklist(nextArtifacts),
  };
  const manifestArtifact = migratedBundle.artifacts.find((artifact) => artifact.type === 'export-manifest');
  if (manifestArtifact) {
    manifestArtifact.content = buildExportManifest(migratedBundle);
  }
  return migratedBundle;
}

function buildValidationResult(
  validation: ViewModelValidationResult,
  viewModel: Record<string, unknown> | undefined,
) {
  return {
    valid: validation.valid,
    errors: validation.errors,
    findings: validation.findings,
    checkedRules:
      isRecord(viewModel?.validation) && Array.isArray(viewModel.validation.checkedRules)
        ? viewModel.validation.checkedRules
        : [],
  };
}

function buildSourceCodeSummary(projectName: string) {
  return JSON.stringify(
    {
      title: `${projectName}源码工程`,
      root: 'source/mbse-workbench',
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
      purpose: '导出完整工作台源码，便于归档、复核运行环境与继续演化。',
    },
    null,
    2,
  );
}

function buildDesktopAppSummary(projectName: string) {
  return JSON.stringify(
    {
      title: `${projectName}桌面应用`,
      releaseSource: 'src-tauri/target/release/mbse-course-practice.exe',
      exportPath: 'runnable/mbse-workbench.exe',
      appShell: 'Tauri 桌面壳',
      managedProcess: 'Agent Sidecar',
      verification: ['打开导出的桌面应用', '确认应用可以加载已保存项目并展示多视图'],
    },
    null,
    2,
  );
}

function buildChecklist(artifacts: ProjectExportArtifact[]): ProjectExportChecklistItem[] {
  return [
    buildChecklistItem('source-code', '源码工程', artifacts, ['source-code']),
    buildChecklistItem('desktop-app', '桌面应用', artifacts, ['desktop-app']),
    buildChecklistItem('saved-project', '项目快照', artifacts, ['saved-project']),
    buildChecklistItem('model-source', 'SysML v2 文本', artifacts, ['sysml-v2']),
    buildChecklistItem('view-model', 'JSON 视图模型', artifacts, ['json-view-model']),
    buildChecklistItem('validation', 'validation 结果', artifacts, ['validation-result']),
    buildChecklistItem('export-manifest', '导出清单', artifacts, ['export-manifest']),
  ];
}

function buildChecklistItem(
  id: string,
  title: string,
  artifacts: ProjectExportArtifact[],
  types: ProjectExportArtifactType[],
): ProjectExportChecklistItem {
  const matchedArtifacts = artifacts.filter((artifact) => types.includes(artifact.type));
  const statuses = matchedArtifacts.map((artifact) => artifact.status);
  const status = matchedArtifacts.length === 0
    ? 'missing'
    : statuses.every((current) => current === 'included')
      ? 'included'
      : statuses.some((current) => current === 'missing')
        ? 'missing'
        : 'ready';

  return {
    id,
    title,
    status,
    artifactIds: matchedArtifacts.map((artifact) => artifact.id),
  };
}

function buildExportManifest(bundle: ProjectExportBundle) {
  return JSON.stringify(
    {
      projectId: bundle.projectId,
      projectName: bundle.projectName,
      source: bundle.source,
      mode: bundle.mode,
      outputRoot: bundle.outputRoot,
      exportedAt: bundle.exportedAt,
      artifacts: bundle.artifacts.map(({ id, type, title, path, source, required, status, mediaType, detail }) => ({
        id,
        type,
        title,
        path,
        source,
        required,
        status,
        mediaType,
        detail,
      })),
      checklist: bundle.checklist,
    },
    null,
    2,
  );
}

function normalizeLegacyArtifactType(type: string): ProjectExportArtifactType | undefined {
  return Object.prototype.hasOwnProperty.call(LEGACY_ARTIFACT_TYPE_MAP, type)
    ? LEGACY_ARTIFACT_TYPE_MAP[type as keyof typeof LEGACY_ARTIFACT_TYPE_MAP]
    : undefined;
}

function isLegacyOnlyArtifactType(type: string) {
  return type === 'view-report' || type === 'course-report-material' || type === 'demo-guide';
}

function normalizeArtifactStatus(status: string): ProjectExportArtifactStatus {
  return status === 'included' || status === 'missing' ? status : 'ready';
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

function findPersistedFile(savedProject: SavedWorkbenchProjectState, path: string) {
  return savedProject.files.find((file) => normalizePath(file.path) === normalizePath(path));
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

export function isSupportedProjectExportArtifactType(type: string): type is ProjectExportArtifactType {
  return SUPPORTED_EXPORT_ARTIFACT_TYPES.has(type as ProjectExportArtifactType);
}
