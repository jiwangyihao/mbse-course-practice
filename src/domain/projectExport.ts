import { validateViewModel, type ViewModelValidationResult } from './modelGeneration';
import type { SavedWorkbenchProjectState } from './workbenchProject';
import { validationArtifactPath } from './workbenchProject';

export type ProjectExportArtifactType =
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

const SUPPORTED_EXPORT_ARTIFACT_TYPES: Record<ProjectExportArtifactType, true> = {
  'saved-project': true,
  'sysml-v2': true,
  'json-view-model': true,
  'validation-result': true,
  'export-manifest': true,
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

export function buildProjectExportBundle(savedProject: SavedWorkbenchProjectState): ProjectExportBundle {
  const projectId = readString(savedProject.manifest.id, 'unknown-project');
  const projectName = readString(savedProject.manifest.name, projectId);
  const projectExportRoot = `project/${projectId}`;
  const projectContentRoot = `${projectExportRoot}/sample-projects/${projectId}`;
  const sysmlArtifacts = savedProject.modelArtifacts.filter((artifact) => artifact.kind === 'sysml-v2');
  const viewModelArtifact = savedProject.modelArtifacts.find((artifact) => artifact.kind === 'json-view-model');
  const sysmlExportArtifacts: ProjectExportArtifact[] = sysmlArtifacts.map((artifact, index) => {
    const sysmlFile = findPersistedFile(savedProject, artifact.path);
    const relativeModelPath = artifact.path.replace(/^sample-projects\/[^/]+\/model\//, '');
    return {
      id: artifact.id || `${projectId}-sysml-${index}`,
      type: 'sysml-v2',
      title: artifact.title || `SysML v2 源文件 ${relativeModelPath}`,
      path: `${projectContentRoot}/model/${relativeModelPath}`,
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
      id: `${projectId}-saved-project`.replace('tianwen-2', 'tw2'),
      type: 'saved-project',
      title: '已保存项目快照',
      path: projectExportRoot,
      source: savedProject.manifestPath,
      required: true,
      status: 'ready',
      mediaType: 'application/json',
      content: JSON.stringify(
        {
          statePath: `${projectExportRoot}/workbench-state.json`,
          manifestPath: savedProject.manifestPath,
          files: savedProject.files.map((file) => ({
            path: `${projectExportRoot}/${normalizePath(file.path)}`,
            mediaType: file.mediaType,
          })),
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
      path: `${projectContentRoot}/model/view-model.json`,
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
      path: `${projectContentRoot}/model/validation-result.json`,
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
  const requiresMigration = artifacts.some((artifact) => !isSupportedProjectExportArtifactType(artifact.type));
  if (!requiresMigration) {
    return bundle;
  }

  const plannedBundle = buildProjectExportBundle(savedProject);
  const previousByType = new Map<ProjectExportArtifactType, typeof artifacts[number]>();
  for (const artifact of artifacts) {
    if (!isSupportedProjectExportArtifactType(artifact.type) || previousByType.has(artifact.type)) {
      continue;
    }
    previousByType.set(artifact.type, artifact);
  }

  const nextArtifacts: ProjectExportArtifact[] = plannedBundle.artifacts.map((artifact) => {
    const previousArtifact = previousByType.get(artifact.type);
    if (!previousArtifact) {
      return artifact;
    }
    const status: ProjectExportArtifactStatus =
      previousArtifact.status === 'included' || previousArtifact.status === 'missing'
        ? previousArtifact.status
        : 'ready';
    return {
      ...artifact,
      status,
      detail: previousArtifact.detail,
    };
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

function buildChecklist(artifacts: ProjectExportArtifact[]): ProjectExportChecklistItem[] {
  return [
    buildChecklistItem('saved-project', '项目内容', artifacts, ['saved-project']),
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
  return Object.prototype.hasOwnProperty.call(SUPPORTED_EXPORT_ARTIFACT_TYPES, type);
}
