export type ExtractionDisclosureCategory = 'external-source' | 'engineering-assumption' | 'open-question';
export type ExtractionDisclosureConfidence = 'high' | 'medium' | 'low';

export interface ExtractionDisclosure {
  message: string;
  recommendation: string;
  severity: 'info' | 'warning';
  category: ExtractionDisclosureCategory;
  confidence: ExtractionDisclosureConfidence;
  sourceUrls: string[];
  affectedElements: string[];
}


export function buildExtractionPrompt(sourceText: string, candidatePath: string): string;

export function collectResearchedSourceUrls(events: readonly unknown[]): Set<string>;

export function reconcileExtractionDisclosures(
  suggestions: unknown,
  researchedSourceUrls: Iterable<string>,
): ExtractionDisclosure[];

export function validateExtractionDisclosures(
  suggestions: unknown,
  researchedSourceUrls?: Iterable<string>,
): void;
