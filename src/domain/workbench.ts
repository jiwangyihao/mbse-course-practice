export interface WorkbenchEntry {
  productName: string;
  workspaceBoundary: string;
  sampleProjectId: string;
  sampleProjectName: string;
}

export interface SampleProjectManifest {
  id: string;
  name: string;
  caseName: string;
  productBoundary: string;
  workspaceBoundary: string;
  description: string;
  sourceMaterials: Array<{
    id: string;
    title: string;
    kind: 'mission-brief' | 'requirements-brief';
    path: string;
  }>;
  modelArtifacts: Array<{
    id: string;
    title: string;
    kind: 'sysml-v2' | 'json-view-model';
    path: string;
    placeholder: boolean;
  }>;
}

export interface SourceMaterial {
  id: string;
  title: string;
  kind: SampleProjectManifest['sourceMaterials'][number]['kind'];
  path: string;
  content: string;
}

export interface ModelArtifact {
  id: string;
  title: string;
  kind: SampleProjectManifest['modelArtifacts'][number]['kind'];
  path: string;
  placeholder: boolean;
  content: string;
}

export interface ViewModelSummary {
  schemaVersion: string;
  projectId: string;
  views: Array<{
    id: string;
    title: string;
    kind: string;
    nodeCount: number;
    edgeCount: number;
  }>;
}

export interface BundledSampleProject {
  manifest: SampleProjectManifest;
  sourceMaterials: SourceMaterial[];
  modelArtifacts: ModelArtifact[];
  viewModelSummary: ViewModelSummary;
}

export const workbenchEntry: WorkbenchEntry = {
  productName: 'MBSE 建模工作台',
  workspaceBoundary: '独立工作区 C:\\tmp\\mbse-course-practice',
  sampleProjectId: 'tianwen-2',
  sampleProjectName: '天问二号探测器样例项目',
};
