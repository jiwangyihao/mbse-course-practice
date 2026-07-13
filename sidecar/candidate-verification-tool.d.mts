import type { ConfirmedTianwen2Data } from '../src/domain/modelGeneration';

export interface CandidateVerificationResultDetails {
  valid: boolean;
  status: string;
  invocationAccepted: true;
  invocationParameters: Record<string, never>;
  candidatePath: string;
  nextAction: string;
  error?: string;
}

export interface CandidateVerificationTool {
  name: 'verify_candidate';
  label: string;
  description: string;
  parameters: unknown;
  approval: 'read';
  execute(
    toolCallId: string,
    parameters: Record<string, never>,
  ): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details: CandidateVerificationResultDetails;
  }>;
}

export interface CandidateVerificationGate {
  tool: CandidateVerificationTool;
  createYieldGuardExtension(pi: {
    on(event: 'tool_call', handler: (event: { toolName?: string }) => unknown): void;
  }): void;
  requireVerifiedCandidate(): Promise<ConfirmedTianwen2Data>;
}

export function createCandidateVerificationGate(options: {
  candidatePath: string;
  validateConfirmedData: (confirmedData: unknown) => void;
}): CandidateVerificationGate;
