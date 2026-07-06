export interface WorkbenchEntry {
  productName: string;
  courseName: string;
  workspaceBoundary: string;
  sampleProjectId: string;
  sampleProjectName: string;
}

export interface SampleProjectManifest {
  id: string;
  name: string;
  caseName: string;
  course: string;
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
  courseName: '《基于模型的系统工程》课程大实践',
  workspaceBoundary: '独立大实践工作区 C:\\tmp\\mbse-course-practice，不属于前 12 个小实验工作区 C:\\tmp\\mbse-course-lab',
  sampleProjectId: 'tianwen-2',
  sampleProjectName: '天问二号探测器样例项目',
};
