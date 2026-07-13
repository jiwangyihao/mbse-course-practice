import { extractTianwen2ConfirmedData } from '../../src/domain/modelGeneration';
import { generateTianwen2ModelArtifacts } from '../../src/domain/modelGeneration.node';
import type { ModelGenerationResult } from '../../src/domain/modelGeneration';

const sourceText = [
  '天问二号任务面向小行星取样返回和主带彗星探测。',
  'REQ-TW2-001：任务应支持对目标小行星开展近距离探测并完成取样返回。',
  'REQ-TW2-004：探测器应通过测控通信分系统完成深空测控、数据下传和遥测接收。',
  '航天器平台应为载荷、推进、能源、热控和测控通信分系统提供统一承载。',
].join('\n');

let cachedDraftPromise: Promise<ModelGenerationResult> | undefined;

export async function loadNodeGeneratedDraft() {
  if (!cachedDraftPromise) {
    cachedDraftPromise = generateTianwen2ModelArtifacts(extractTianwen2ConfirmedData(sourceText));
  }
  return cachedDraftPromise;
}
