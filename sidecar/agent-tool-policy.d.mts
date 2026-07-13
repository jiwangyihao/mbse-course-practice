export const MAX_INLINE_EVAL_CHARACTERS: number;
export const MAX_INLINE_EVAL_LINES: number;

export interface ToolCallPolicyEvent {
  toolName: string;
  input?: Record<string, unknown>;
}

export interface ToolCallPolicyResult {
  block: true;
  reason: string;
}

export interface ToolPolicyApi {
  on(
    event: 'tool_call',
    handler: (event: ToolCallPolicyEvent) => Promise<ToolCallPolicyResult | undefined>,
  ): void;
}

export interface SessionToolRegistry {
  getAllToolNames(): string[];
  getActiveToolNames(): string[];
  setActiveToolsByName(toolNames: string[]): Promise<void>;
}

export function createAgentToolPolicyExtension(api: ToolPolicyApi): void;

export function ensureRequiredToolsActive(
  session: SessionToolRegistry,
  requiredToolNames: Iterable<string>,
): Promise<string[]>;
