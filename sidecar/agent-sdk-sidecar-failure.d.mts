export function emitSidecarFailure(
  trace: {
    events: Array<{ type: string }>;
    emitError: (message: string, options: {
      phase: string;
      rawKind: string;
      recoverable: boolean;
      code: string;
      payload: Record<string, unknown>;
    }) => void;
    emitSessionFinished: (status: 'error', completedAt: string, payload: Record<string, unknown>) => void;
  },
  error: unknown,
  phase: string,
  code: string,
  payload?: Record<string, unknown>,
): void;
