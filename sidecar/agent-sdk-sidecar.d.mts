export const DEFAULT_AGENT_MODEL_PATTERN: 'openai-codex/gpt-5.6-sol';

export interface CreateSdkSessionOptions {
  outputSchema?: unknown;
  systemPrompt: string;
  cwd?: string;
  customTools?: unknown[];
  extensions?: unknown[];
  requiredToolNames?: readonly string[];
  requireYieldTool?: boolean;
  allBuiltInTools?: boolean;
  toolNames?: readonly string[];
}

export function createSdkSession(options: CreateSdkSessionOptions): Promise<{
  session: unknown;
  modelFallbackMessage?: string | null;
  activeToolNames: string[];
}>;
