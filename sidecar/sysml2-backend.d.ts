export class Sysml2BackendUnavailableError extends Error {}

export interface Sysml2Diagnostic {
  severity: number;
  message: string;
  source: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  filePath: string;
}

export interface Sysml2SemanticDocument {
  meta?: {
    source?: string;
    [key: string]: unknown;
  };
  elements?: Array<Record<string, unknown>>;
  relationships?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface Sysml2ValidationResult {
  valid: boolean;
  diagnostics: Sysml2Diagnostic[];
  backend: 'sysml2';
}

export interface Sysml2AnalysisResult extends Sysml2ValidationResult {
  semanticDocuments: Sysml2SemanticDocument[];
  exitCode: number;
}

export function runSysml2Analysis(input: {
  workspaceRoot: string;
  filePath: string;
  text?: string;
  timeoutMs?: number;
  select?: string[];
}): Promise<Sysml2AnalysisResult>;

export function validateSysmlWithSysml2(input: {
  workspaceRoot: string;
  filePath: string;
  text?: string;
  timeoutMs?: number;
}): Promise<Sysml2ValidationResult>;
