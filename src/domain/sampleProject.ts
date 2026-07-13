import manifestData from '../../sample-projects/tianwen-2/project.json';
import sourceMaterialText from '../../sample-projects/tianwen-2/materials/source-material.md?raw';
import modelEntryText from '../../sample-projects/tianwen-2/model/model.sysml?raw';
import requirementsText from '../../sample-projects/tianwen-2/model/requirements.sysml?raw';
import structureText from '../../sample-projects/tianwen-2/model/structure.sysml?raw';
import behaviorText from '../../sample-projects/tianwen-2/model/behavior.sysml?raw';
import constraintsText from '../../sample-projects/tianwen-2/model/constraints.sysml?raw';
import viewModel from '../../sample-projects/tianwen-2/model/view-model.json';
import type { BundledSampleProject, SampleProjectManifest, ViewModelSummary } from './workbench';

const manifest = manifestData as SampleProjectManifest;
const sysmlContentByPath = new Map<string, string>([
  ['sample-projects/tianwen-2/model/model.sysml', modelEntryText],
  ['sample-projects/tianwen-2/model/requirements.sysml', requirementsText],
  ['sample-projects/tianwen-2/model/structure.sysml', structureText],
  ['sample-projects/tianwen-2/model/behavior.sysml', behaviorText],
  ['sample-projects/tianwen-2/model/constraints.sysml', constraintsText],
]);

export function loadBundledTianwen2Project(): BundledSampleProject {
  const sourceMaterials = manifest.sourceMaterials.map((material) => ({
    ...material,
    content: sourceMaterialText,
  }));

  const modelArtifacts = manifest.modelArtifacts.map((artifact) => ({
    ...artifact,
    content: artifact.kind === 'sysml-v2'
      ? sysmlContentByPath.get(artifact.path) ?? ''
      : JSON.stringify(viewModel, null, 2),
  }));

  return {
    manifest,
    sourceMaterials,
    modelArtifacts,
    viewModelSummary: summarizeViewModel(viewModel as ViewModelDocument),
  };
}

interface ViewModelDocument {
  schemaVersion: string;
  projectId: string;
  views: Array<{
    id: string;
    title: string;
    kind: string;
    nodes?: unknown[];
    edges?: unknown[];
  }>;
}

function summarizeViewModel(model: ViewModelDocument): ViewModelSummary {
  return {
    schemaVersion: model.schemaVersion,
    projectId: model.projectId,
    views: model.views.map((view) => ({
      id: view.id,
      title: view.title,
      kind: view.kind,
      nodeCount: view.nodes?.length ?? 0,
      edgeCount: view.edges?.length ?? 0,
    })),
  };
}
