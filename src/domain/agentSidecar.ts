import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { validateViewModel, type ConfirmedTianwen2Data, type ModelGenerationResult } from './modelGeneration';

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
      type: 'suggestion';
      message: string;
      target: 'extraction' | 'model-draft';
      recommendation: string;
      severity: 'info' | 'warning';
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
  provider?: string;
  model?: string;
  completedAt?: string;
  events: AgentSidecarEvent[];
}

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface AgentSidecarClient {
  start(): Promise<AgentSidecarStatus>;
  stop(): Promise<AgentSidecarStatus>;
  status(): Promise<AgentSidecarStatus>;
  preflight(): Promise<AgentSidecarStatus>;
  extractCandidates(sourceText: string): Promise<AgentModelingSession>;
  generateDraft(sourceText: string, confirmedData: ConfirmedTianwen2Data): Promise<AgentModelingSession>;
}

export function createAgentSidecarClient({ invoke = tauriInvoke }: { invoke?: TauriInvoke } = {}): AgentSidecarClient {
  return {
    start: () => invoke<AgentSidecarStatus>('start_agent_sidecar'),
    stop: () => invoke<AgentSidecarStatus>('stop_agent_sidecar'),
    status: () => invoke<AgentSidecarStatus>('agent_sidecar_status'),
    preflight: () => invoke<AgentSidecarStatus>('preflight_agent_sidecar'),
    extractCandidates: async (sourceText) =>
      normalizeAgentModelingSession(await invoke<AgentModelingSession>('extract_agent_candidates', { sourceText })),
    generateDraft: async (sourceText, confirmedData) =>
      normalizeAgentModelingSession(
        await invoke<AgentModelingSession>('generate_agent_model_draft', { sourceText, confirmedData }),
      ),
  };
}

function normalizeAgentModelingSession(session: AgentModelingSession): AgentModelingSession {
  return {
    ...session,
    events: session.events.map((event) =>
      event.type === 'model-draft'
        ? {
            ...event,
            draft: {
              ...event.draft,
              validation: validateViewModel(event.draft.viewModel),
            },
          }
        : event,
    ),
  };
}
