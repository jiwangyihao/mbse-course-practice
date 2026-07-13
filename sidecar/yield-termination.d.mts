export interface YieldTerminationSession {
  subscribe(listener: (event: {
    type?: string;
    toolName?: string;
    isError?: boolean;
    result?: { details?: { status?: string; type?: string | string[] } };
  }) => void): () => void;
  prompt(promptText: string): Promise<void>;
  waitForIdle(): Promise<void>;
  abort(options: { goalReason: 'internal' }): Promise<void>;
}

export function promptUntilSuccessfulYield(options: {
  session: YieldTerminationSession;
  promptText: string;
  onEvent?: (event: unknown) => void;
}): Promise<{ terminatedByYield: boolean }>;
