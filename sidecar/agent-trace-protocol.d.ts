export type JsonSafeValue = null | boolean | number | string | JsonSafeValue[] | { [key: string]: JsonSafeValue };

export type TraceEvent = {
  protocolVersion: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  phase: string;
  type: string;
  rawKind: string;
  message: string;
  payload: JsonSafeValue;
  [key: string]: unknown;
};

export type TraceCollector = {
  sessionId: string;
  provider?: string;
  model?: string;
  events: TraceEvent[];
  emit(event: {
    type: string;
    phase?: string;
    rawKind: string;
    message: string;
    payload: unknown;
    [key: string]: unknown;
  }): TraceEvent;
  emitSessionStarted(extra?: Record<string, unknown>): TraceEvent;
  emitProgress(message: string, percent: number, phase?: string, payload?: Record<string, unknown>): TraceEvent;
  emitPhase(phase: string, phaseStatus: 'started' | 'completed', step: string, payload?: Record<string, unknown>): TraceEvent;
  emitError(message: string, options?: {
    phase?: string;
    rawKind?: string;
    recoverable?: boolean;
    code?: string;
    payload?: Record<string, unknown>;
  }): TraceEvent;
  emitSessionFinished(status: 'success' | 'error' | 'cancelled', completedAt: string, payload?: Record<string, unknown>): TraceEvent;
};

export function createTraceCollector(args: {
  sessionId: string;
  provider?: string;
  model?: string;
  emitFrame?: (event: TraceEvent) => void;
}): TraceCollector;

export function safeErrorMessage(error: unknown): string;

export type ForwardedSdkSessionEvent =
  | { kind: 'tool-call-end'; toolName: string; isError: boolean; yieldDetails?: unknown }
  | { kind: 'inspection-error' }
  | undefined;

export function forwardSdkSessionEvent(trace: TraceCollector, event: unknown, defaultPhase: string): ForwardedSdkSessionEvent;
