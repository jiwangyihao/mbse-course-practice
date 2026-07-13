export interface CandidateWorkspace {
  root: string;
  candidatePath: string;
  candidateRelativePath: string;
  dispose(): Promise<void>;
}

export function createCandidateWorkspace(
  sourceText: string,
  confirmedDataSchema: Record<string, unknown>,
): Promise<CandidateWorkspace>;

export const candidateWorkspacePaths: {
  candidate: string;
  schema: string;
};
