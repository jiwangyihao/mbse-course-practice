import type { ConfirmedTianwen2Data, ModelGenerationResult } from './modelGeneration';
import type { ProjectExportBundle } from './projectExport';
import type { BundledSampleProject, ModelArtifact, SampleProjectManifest, SourceMaterial } from './workbench';

export interface PersistedProjectFile {
  path: string;
  content: string;
  mediaType: string;
}

export interface SavedWorkbenchProjectState {
  projectRoot: string | null;
  savedAt: string | null;
  manifestPath: string;
  manifest: SampleProjectManifest;
  sourceMaterials: SourceMaterial[];
  modelArtifacts: ModelArtifact[];
  confirmedData: ConfirmedTianwen2Data | null;
  generatedArtifacts: ModelGenerationResult | null;
  sidecarDraft: ModelGenerationResult | null;
  lastExportedBundle: ProjectExportBundle | null;
  files: PersistedProjectFile[];
}

export interface WorkbenchProjectResource {
  id: string;
  title: string;
  kind: '项目清单' | '源材料' | 'SysML v2' | '视图模型' | 'validation' | 'Sidecar 草案';
  path: string;
  mediaType: string;
  content: string;
}

export function createWorkbenchProjectState(
  project: BundledSampleProject,
  options: {
    confirmedData?: ConfirmedTianwen2Data | null;
    generatedArtifacts?: ModelGenerationResult | null;
    sidecarDraft?: ModelGenerationResult | null;
    lastExportedBundle?: ProjectExportBundle | null;
    projectRoot?: string | null;
    savedAt?: string | null;
    sourceText?: string;
  } = {},
): SavedWorkbenchProjectState {
  const generatedArtifacts = options.generatedArtifacts ?? null;
  const sidecarDraft = options.sidecarDraft ?? null;
  const sourceMaterials = project.sourceMaterials.map((material, index) => ({
    ...material,
    content: index === 0 && typeof options.sourceText === 'string' ? options.sourceText : material.content,
  }));
  const modelArtifacts = project.modelArtifacts.map((artifact) => hydrateModelArtifact(artifact, generatedArtifacts));
  const manifestPath = `sample-projects/${project.manifest.id}/project.json`;
  const files: PersistedProjectFile[] = [
    {
      path: manifestPath,
      mediaType: 'application/json',
      content: JSON.stringify(project.manifest, null, 2),
    },
    ...sourceMaterials.map((material) => ({
      path: material.path,
      mediaType: 'text/markdown',
      content: material.content,
    })),
    ...modelArtifacts.map((artifact) => ({
      path: artifact.path,
      mediaType: artifact.kind === 'sysml-v2' ? 'text/x-sysml' : 'application/json',
      content: artifact.content,
    })),
  ];
  if (sidecarDraft) {
    files.push(
      ...buildSidecarDraftSourceFiles(project.manifest.id, sidecarDraft),
      {
        path: `sample-projects/${project.manifest.id}/sidecar/agent-model-draft-view-model.json`,
        mediaType: 'application/json',
        content: JSON.stringify(sidecarDraft.viewModel, null, 2),
      },
      {
        path: `sample-projects/${project.manifest.id}/sidecar/agent-model-draft-validation.json`,
        mediaType: 'application/json',
        content: JSON.stringify(sidecarDraft.validation, null, 2),
      },
    );
  }

  if (generatedArtifacts) {
    files.push({
      path: validationArtifactPath(project.manifest.id),
      mediaType: 'application/json',
      content: JSON.stringify(generatedArtifacts.validation, null, 2),
    });
  }

  return {
    projectRoot: options.projectRoot ?? null,
    savedAt: options.savedAt ?? null,
    manifestPath,
    manifest: { ...project.manifest },
    sourceMaterials,
    modelArtifacts,
    confirmedData: options.confirmedData ?? null,
    generatedArtifacts,
    sidecarDraft,
    lastExportedBundle: options.lastExportedBundle ?? null,
    files,
  };
}

export function listWorkbenchProjectResources(state: SavedWorkbenchProjectState): WorkbenchProjectResource[] {
  const resources: WorkbenchProjectResource[] = [
    {
      id: 'project-manifest',
      title: '项目清单',
      kind: '项目清单',
      path: state.manifestPath,
      mediaType: 'application/json',
      content: JSON.stringify(state.manifest, null, 2),
    },
    ...state.sourceMaterials.map((material) => ({
      id: material.id,
      title: material.title,
      kind: '源材料' as const,
      path: material.path,
      mediaType: 'text/markdown',
      content: material.content,
    })),
    ...state.modelArtifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind === 'sysml-v2' ? ('SysML v2' as const) : ('视图模型' as const),
      path: artifact.path,
      mediaType: artifact.kind === 'sysml-v2' ? 'text/x-sysml' : 'application/json',
      content: artifact.content,
    })),
  ];

  if (state.generatedArtifacts) {
    resources.push({
      id: 'generated-validation-result',
      title: 'validation 结果',
      kind: 'validation',
      path: validationArtifactPath(state.manifest.id),
      mediaType: 'application/json',
      content: JSON.stringify(state.generatedArtifacts.validation, null, 2),
    });
  }
  if (state.sidecarDraft) {
    const sidecarDraft = state.sidecarDraft;
    resources.push(
      ...buildSidecarDraftSourceResources(state.manifest.id, sidecarDraft),
      {
        id: 'sidecar-draft-view-model',
        title: 'Sidecar 草案视图模型 JSON',
        kind: 'Sidecar 草案',
        path: `sample-projects/${state.manifest.id}/sidecar/agent-model-draft-view-model.json`,
        mediaType: 'application/json',
        content: JSON.stringify(sidecarDraft.viewModel, null, 2),
      },
      {
        id: 'sidecar-draft-validation',
        title: 'Sidecar 草案 validation',
        kind: 'Sidecar 草案',
        path: `sample-projects/${state.manifest.id}/sidecar/agent-model-draft-validation.json`,
        mediaType: 'application/json',
        content: JSON.stringify(sidecarDraft.validation, null, 2),
      },
    );
  }

  return resources;
}

export function findWorkbenchProjectResource(
  state: SavedWorkbenchProjectState,
  resourceId: string,
): WorkbenchProjectResource | undefined {
  return listWorkbenchProjectResources(state).find((resource) => resource.id === resourceId);
}

export function validationArtifactPath(projectId: string) {
  return `sample-projects/${projectId}/model/validation-result.json`;
}

function sidecarDraftSourceRoot(projectId: string, draft: ModelGenerationResult) {
  const base = `sample-projects/${projectId}/sidecar/agent-model-draft`;
  return draft.sourceSet.rootDir === '' ? base : `${base}/${draft.sourceSet.rootDir}`;
}

function sidecarDraftSourceFilePath(projectId: string, draft: ModelGenerationResult, relativePath: string) {
  return `${sidecarDraftSourceRoot(projectId, draft)}/${relativePath}`;
}

function sidecarDraftSourceResourceId(relativePath: string) {
  return `sidecar-draft-source-${relativePath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

function buildSidecarDraftSourceFiles(projectId: string, draft: ModelGenerationResult): PersistedProjectFile[] {
  return draft.sourceSet.files.map((file) => ({
    path: sidecarDraftSourceFilePath(projectId, draft, file.path),
    mediaType: 'text/x-sysml',
    content: file.content,
  }));
}

function buildSidecarDraftSourceResources(projectId: string, draft: ModelGenerationResult): WorkbenchProjectResource[] {
  return draft.sourceSet.files.map((file) => ({
    id: sidecarDraftSourceResourceId(file.path),
    title: `Sidecar 草案 SysML v2：${file.path}`,
    kind: 'Sidecar 草案',
    path: sidecarDraftSourceFilePath(projectId, draft, file.path),
    mediaType: 'text/x-sysml',
    content: file.content,
  }));
}

function hydrateModelArtifact(artifact: ModelArtifact, generatedArtifacts: ModelGenerationResult | null): ModelArtifact {
  if (!generatedArtifacts) {
    return { ...artifact };
  }

  if (artifact.kind === 'sysml-v2') {
    const relativePath = artifact.path.replace(/^sample-projects\/[^/]+\/model\//, '');
    const file = generatedArtifacts.sourceSet.files.find((candidate) => candidate.path === relativePath)
      ?? generatedArtifacts.sourceSet.files.find((candidate) => candidate.path === generatedArtifacts.sourceSet.entryPath);
    return {
      ...artifact,
      placeholder: false,
      content: file?.content ?? '',
    };
  }

  return {
    ...artifact,
    placeholder: false,
    content: JSON.stringify(generatedArtifacts.viewModel, null, 2),
  };
}
