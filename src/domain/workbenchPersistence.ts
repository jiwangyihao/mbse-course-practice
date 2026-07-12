import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { ProjectExportBundle } from './projectExport';
import type { SavedWorkbenchProjectState } from './workbenchProject';

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface WorkbenchPersistenceClient {
  saveProject(project: SavedWorkbenchProjectState): Promise<SavedWorkbenchProjectState>;
  loadProject(projectId: string): Promise<SavedWorkbenchProjectState>;
  exportProject(projectId: string): Promise<ProjectExportBundle>;
}

export function createWorkbenchPersistenceClient({ invoke = tauriInvoke }: { invoke?: TauriInvoke } = {}): WorkbenchPersistenceClient {
  return {
    saveProject: (project) => invoke<SavedWorkbenchProjectState>('save_workbench_project', { project }),
    loadProject: (projectId) => invoke<SavedWorkbenchProjectState>('load_workbench_project', { projectId }),
    exportProject: (projectId) => invoke<ProjectExportBundle>('export_workbench_project', { projectId }),
  };
}
