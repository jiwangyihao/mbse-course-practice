import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { validateViewModel, type ConfirmedTianwen2Data, type ModelGenerationResult } from './modelGeneration';
import { AGENT_TRACE_PROTOCOL_VERSION } from '../../sidecar/agent-trace-shared.mjs';

export type AgentSidecarState = 'stopped' | 'starting' | 'running' | 'error';
export type AgentTracePhase = 'bootstrap' | 'extraction' | 'model-draft' | 'workspace' | 'validation' | 'session' | 'unknown';
export type AgentTraceEventType =
  | 'session-started'
  | 'progress'
  | 'phase'
  | 'suggestion'
  | 'extraction'
  | 'model-draft'
  | 'tool-call-start'
  | 'tool-call-update'
  | 'tool-call-end'
  | 'reasoning-start'
  | 'reasoning-delta'
  | 'reasoning-end'
  | 'reasoning-summary'
  | 'output-delta'
  | 'error'
  | 'session-finished'
  | 'sdk-event';
export type AgentOutputChannel = 'assistant-text' | 'assistant-toolcall' | 'tool-output' | 'agent-note';
export type JsonSafeValue = null | boolean | number | string | JsonSafeValue[] | { [key: string]: JsonSafeValue };

export interface AgentSidecarStatus {
  state: AgentSidecarState;
  pid: number | null;
  endpoint: string | null;
  message?: string;
}

interface AgentTraceEventBase {
  protocolVersion: typeof AGENT_TRACE_PROTOCOL_VERSION;
  sessionId: string;
  sequence: number;
  timestamp: string;
  phase: AgentTracePhase;
  type: AgentTraceEventType;
  rawKind: string;
  message: string;
  payload: JsonSafeValue;
}

export type AgentSidecarEvent =
  | (AgentTraceEventBase & {
      type: 'session-started';
      provider?: string;
      model?: string;
    })
  | (AgentTraceEventBase & {
      type: 'progress';
      percent: number;
    })
  | (AgentTraceEventBase & {
      type: 'phase';
      phaseStatus: 'started' | 'completed';
      step: string;
    })
  | (AgentTraceEventBase & {
      type: 'suggestion';
      target: 'extraction' | 'model-draft';
      recommendation: string;
      severity: 'info' | 'warning';
      category?: 'external-source' | 'engineering-assumption' | 'open-question';
      confidence?: 'high' | 'medium' | 'low';
      sourceUrls?: string[];
      affectedElements?: string[];
    })
  | (AgentTraceEventBase & {
      type: 'extraction';
      confirmedData: ConfirmedTianwen2Data;
    })
  | (AgentTraceEventBase & {
      type: 'model-draft';
      draft: ModelGenerationResult;
      executionReport?: {
        summary?: string;
        actions?: string[];
        verificationNotes?: string[];
      };
    })
  | (AgentTraceEventBase & {
      type: 'tool-call-start';
      toolCallId: string;
      toolName: string;
      argsSummary?: string;
    })
  | (AgentTraceEventBase & {
      type: 'tool-call-update';
      toolCallId: string;
      toolName: string;
      argsSummary?: string;
      partialSummary?: string;
    })
  | (AgentTraceEventBase & {
      type: 'tool-call-end';
      toolCallId: string;
      toolName: string;
      argsSummary?: string;
      resultSummary?: string;
      isError: boolean;
    })
  | (AgentTraceEventBase & {
      type: 'reasoning-start';
      contentIndex?: number;
    })
  | (AgentTraceEventBase & {
      type: 'reasoning-delta';
      contentIndex?: number;
      text: string;
    })
  | (AgentTraceEventBase & {
      type: 'reasoning-end';
      contentIndex?: number;
      text: string;
    })
  | (AgentTraceEventBase & {
      type: 'reasoning-summary';
      hasContent: boolean;
      summaryText?: string;
    })
  | (AgentTraceEventBase & {
      type: 'output-delta';
      channel: AgentOutputChannel;
      text: string;
    })
  | (AgentTraceEventBase & {
      type: 'error';
      recoverable: boolean;
      code?: string;
    })
  | (AgentTraceEventBase & {
      type: 'session-finished';
      status: 'success' | 'error' | 'cancelled';
      provider?: string;
      model?: string;
      completedAt?: string;
    })
  | (AgentTraceEventBase & {
      type: 'sdk-event';
    });

export interface AgentModelingSession {
  sessionId: string;
  provider?: string;
  model?: string;
  completedAt?: string;
  events: AgentSidecarEvent[];
}

type LegacyAgentSidecarEvent =
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
      executionReport?: {
        summary?: string;
        actions?: string[];
        verificationNotes?: string[];
      };
    }
  | {
      type: 'error';
      message: string;
      recoverable: boolean;
    };

export type AgentSidecarEventInput = AgentSidecarEvent | LegacyAgentSidecarEvent;

type AgentModelingSessionInput = Omit<AgentModelingSession, 'events'> & {
  events: AgentSidecarEventInput[];
};

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
      normalizeAgentModelingSession(await invoke<AgentModelingSessionInput>('extract_agent_candidates', { sourceText })),
    generateDraft: async (sourceText, confirmedData) =>
      normalizeAgentModelingSession(
        await invoke<AgentModelingSessionInput>('generate_agent_model_draft', { sourceText, confirmedData }),
      ),
  };
}

export function createLegacyAgentModelingSession(session: AgentModelingSessionInput): AgentModelingSession {
  return normalizeAgentModelingSession(session);
}

export function normalizeAgentModelingSession(session: AgentModelingSessionInput): AgentModelingSession {
  const normalizedEvents = dedupeAndSortEvents(
    session.events.map((event, index) => normalizeAgentSidecarEvent(event, session.sessionId, index + 1)),
  );
  const startedEvent = normalizedEvents.find(
    (event): event is Extract<AgentSidecarEvent, { type: 'session-started' }> => event.type === 'session-started',
  );
  const finishedEvent = [...normalizedEvents]
    .reverse()
    .find((event): event is Extract<AgentSidecarEvent, { type: 'session-finished' }> => event.type === 'session-finished');

  return {
    sessionId: session.sessionId,
    provider: session.provider ?? finishedEvent?.provider ?? startedEvent?.provider,
    model: session.model ?? finishedEvent?.model ?? startedEvent?.model,
    completedAt: session.completedAt ?? finishedEvent?.completedAt,
    events: normalizedEvents,
  };
}

export function createAgentSessionsFromEvents(events: AgentSidecarEvent[]): AgentModelingSession[] {
  const order: string[] = [];
  const grouped = new Map<string, AgentSidecarEvent[]>();
  for (const event of events) {
    if (!grouped.has(event.sessionId)) {
      grouped.set(event.sessionId, []);
      order.push(event.sessionId);
    }
    grouped.get(event.sessionId)?.push(event);
  }
  return order.map((sessionId) =>
    normalizeAgentModelingSession({
      sessionId,
      events: grouped.get(sessionId) ?? [],
    }),
  );
}

export function appendAgentEventsToSessions(
  current: AgentModelingSession[],
  incomingEvents: AgentSidecarEvent[],
): AgentModelingSession[] {
  if (incomingEvents.length === 0) {
    return current;
  }

  const grouped = new Map<string, AgentSidecarEvent[]>();
  for (const event of incomingEvents) {
    const events = grouped.get(event.sessionId);
    if (events) {
      events.push(event);
    } else {
      grouped.set(event.sessionId, [event]);
    }
  }

  const next = [...current];
  const sessionIndexes = new Map(next.map((session, index) => [session.sessionId, index]));
  for (const [sessionId, events] of grouped) {
    const incomingSession = normalizeAgentModelingSession({ sessionId, events });
    const existingIndex = sessionIndexes.get(sessionId);
    if (existingIndex === undefined) {
      sessionIndexes.set(sessionId, next.length);
      next.push(incomingSession);
      continue;
    }

    const existing = next[existingIndex]!;
    next[existingIndex] = {
      sessionId,
      provider: incomingSession.provider ?? existing.provider,
      model: incomingSession.model ?? existing.model,
      completedAt: incomingSession.completedAt ?? existing.completedAt,
      events: appendOrderedEvents(existing.events, incomingSession.events),
    };
  }
  return next;
}

export function mergeAgentModelingSessionList(
  current: AgentModelingSession[],
  incoming: AgentModelingSession | AgentModelingSession[] | null | undefined,
): AgentModelingSession[] {
  const nextList = Array.isArray(incoming) ? incoming : incoming ? [incoming] : [];
  const merged = [...current];
  for (const session of nextList.map(normalizeAgentModelingSession)) {
    const existingIndex = merged.findIndex((candidate) => candidate.sessionId === session.sessionId);
    if (existingIndex < 0) {
      merged.push(session);
      continue;
    }
    merged[existingIndex] = normalizeAgentModelingSession({
      sessionId: session.sessionId,
      provider: session.provider ?? merged[existingIndex].provider,
      model: session.model ?? merged[existingIndex].model,
      completedAt: session.completedAt ?? merged[existingIndex].completedAt,
      events: [...merged[existingIndex].events, ...session.events],
    });
  }
  return merged;
}

export function getLatestAgentSession(sessions: AgentModelingSession[]) {
  return sessions[sessions.length - 1] ?? null;
}

export function getLatestAgentProgress(source: AgentModelingSession[] | AgentModelingSession | null) {
  const session = Array.isArray(source) ? getLatestAgentSession(source) : source;
  return session
    ? [...session.events].reverse().find((event): event is Extract<AgentSidecarEvent, { type: 'progress' }> => event.type === 'progress') ?? null
    : null;
}

export function findLatestAgentEvent<TType extends AgentSidecarEvent['type']>(
  sessions: AgentModelingSession[],
  type: TType,
): Extract<AgentSidecarEvent, { type: TType }> | undefined {
  for (let sessionIndex = sessions.length - 1; sessionIndex >= 0; sessionIndex -= 1) {
    const session = sessions[sessionIndex]!;
    for (let eventIndex = session.events.length - 1; eventIndex >= 0; eventIndex -= 1) {
      const event = session.events[eventIndex]!;
      if (event.type === type) {
        return event as Extract<AgentSidecarEvent, { type: TType }>;
      }
    }
  }
  return undefined;
}

export function getAgentExecutionTimeline(session: AgentModelingSession | null) {
  return session?.events ?? [];
}

function appendOrderedEvents(
  current: AgentSidecarEvent[],
  incoming: AgentSidecarEvent[],
) {
  if (incoming.length === 0) {
    return current;
  }

  let previousSequence = current.at(-1)?.sequence ?? Number.NEGATIVE_INFINITY;
  for (const event of incoming) {
    if (event.sequence <= previousSequence) {
      return dedupeAndSortEvents([...current, ...incoming]);
    }
    previousSequence = event.sequence;
  }
  return [...current, ...incoming];
}

function dedupeAndSortEvents(events: AgentSidecarEvent[]) {
  const sorted = [...events].sort((left, right) => {
    if (left.sessionId !== right.sessionId) {
      return left.sessionId.localeCompare(right.sessionId);
    }
    return left.sequence - right.sequence;
  });
  const deduped = new Map<string, AgentSidecarEvent>();
  for (const event of sorted) {
    deduped.set(`${event.sessionId}:${event.sequence}`, event);
  }
  return [...deduped.values()].sort((left, right) => {
    if (left.sessionId !== right.sessionId) {
      return left.sessionId.localeCompare(right.sessionId);
    }
    return left.sequence - right.sequence;
  });
}

function normalizeAgentSidecarEvent(
  event: AgentSidecarEvent | LegacyAgentSidecarEvent,
  fallbackSessionId: string,
  fallbackSequence: number,
): AgentSidecarEvent {
  if (isProtocolEvent(event)) {
    if (event.type !== 'model-draft') {
      return event;
    }
    return {
      ...event,
      draft: {
        ...event.draft,
        validation: validateViewModel(event.draft.viewModel),
      },
    };
  }

  const base = {
    protocolVersion: AGENT_TRACE_PROTOCOL_VERSION,
    sessionId: fallbackSessionId,
    sequence: fallbackSequence,
    timestamp: new Date(0).toISOString(),
    phase: inferLegacyPhase(event),
    rawKind: event.type,
    message: event.message,
    payload: legacyPayload(event),
  } as const;

  switch (event.type) {
    case 'progress':
      return { ...base, type: 'progress', percent: event.percent };
    case 'extraction':
      return { ...base, type: 'extraction', confirmedData: event.confirmedData };
    case 'suggestion':
      return {
        ...base,
        type: 'suggestion',
        target: event.target,
        recommendation: event.recommendation,
        severity: event.severity,
      };
    case 'model-draft':
      return {
        ...base,
        type: 'model-draft',
        draft: {
          ...event.draft,
          validation: validateViewModel(event.draft.viewModel),
        },
        executionReport: event.executionReport,
      };
    case 'error':
      return { ...base, type: 'error', recoverable: event.recoverable };
  }
}

function isProtocolEvent(event: AgentSidecarEvent | LegacyAgentSidecarEvent): event is AgentSidecarEvent {
  return 'protocolVersion' in event && event.protocolVersion === AGENT_TRACE_PROTOCOL_VERSION;
}

function inferLegacyPhase(event: LegacyAgentSidecarEvent): AgentTracePhase {
  if (event.type === 'extraction') return 'extraction';
  if (event.type === 'model-draft') return 'model-draft';
  if (event.type === 'suggestion') return event.target;
  return 'unknown';
}

function legacyPayload(event: LegacyAgentSidecarEvent): JsonSafeValue {
  switch (event.type) {
    case 'progress':
      return { message: event.message, percent: event.percent };
    case 'extraction':
      return { message: event.message, confirmedData: event.confirmedData as unknown as JsonSafeValue };
    case 'suggestion':
      return {
        message: event.message,
        target: event.target,
        recommendation: event.recommendation,
        severity: event.severity,
      };
    case 'model-draft':
      return {
        message: event.message,
        draft: event.draft as unknown as JsonSafeValue,
        executionReport: (event.executionReport ?? null) as unknown as JsonSafeValue,
      };
    case 'error':
      return { message: event.message, recoverable: event.recoverable };
  }
}
