import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { ConfirmedTianwen2Data, ModelGenerationResult } from './modelGeneration';

export type AgentSidecarState = 'stopped' | 'starting' | 'running' | 'error';

export interface AgentSidecarStatus {
  state: AgentSidecarState;
  pid: number | null;
  endpoint: string | null;
  message?: string;
}

export type AgentSidecarEvent =
  | {
      type: 'progress';
      message: string;
      percent: number;
    }
  | {
      type: 'extraction';
      message: string;
      confirmedData: ConfirmedTianwen2Data;
    }
  | {
      type: 'model-draft';
      message: string;
      draft: ModelGenerationResult;
    }
  | {
      type: 'error';
      message: string;
      recoverable: boolean;
    };

export interface AgentModelingSession {
  sessionId: string;
  events: AgentSidecarEvent[];
}

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface AgentSidecarClient {
  start(): Promise<AgentSidecarStatus>;
  stop(): Promise<AgentSidecarStatus>;
  status(): Promise<AgentSidecarStatus>;
  extractCandidates(sourceText: string): Promise<AgentModelingSession>;
  generateDraft(sourceText: string, confirmedData?: ConfirmedTianwen2Data): Promise<AgentModelingSession>;
}

export function createAgentSidecarClient({ invoke = tauriInvoke }: { invoke?: TauriInvoke } = {}): AgentSidecarClient {
  return {
    start: () => invoke<AgentSidecarStatus>('start_agent_sidecar'),
    stop: () => invoke<AgentSidecarStatus>('stop_agent_sidecar'),
    status: () => invoke<AgentSidecarStatus>('agent_sidecar_status'),
    extractCandidates: (sourceText) => invoke<AgentModelingSession>('extract_agent_candidates', { sourceText }),
    generateDraft: (sourceText, confirmedData) =>
      invoke<AgentModelingSession>('generate_agent_model_draft', {
        sourceText,
        ...(confirmedData ? { confirmedData } : {}),
      }),
  };
}
