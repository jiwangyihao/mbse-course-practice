import { safeErrorMessage } from './agent-trace-protocol.mjs';

export function emitSidecarFailure(trace, error, phase, code, payload = {}) {
  if (trace.events.some((event) => event.type === 'session-finished')) {
    return;
  }
  const message = safeErrorMessage(error);
  const errorPayload = { ...payload, error };
  trace.emitError(message, {
    phase,
    rawKind: 'sidecar_error',
    recoverable: false,
    code,
    payload: errorPayload,
  });
  trace.emitSessionFinished('error', new Date().toISOString(), { ...payload, code });
}
