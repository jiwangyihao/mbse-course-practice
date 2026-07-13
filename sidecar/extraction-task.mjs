
export function buildExtractionPrompt(sourceText, candidatePath) {
  return [
    '这是一个开放式 MBSE 建模任务，不是把用户文本逐字段转换为 confirmedData 的格式转换题。',
    '先阅读当前工作区的 WORKSPACE.md、input/source-material.md 和 references/confirmed-data.schema.json。',
    '输入材料只是建模起点。本会话开放全部 OMP 内置工具；先提取材料中的明确事实，再识别缺口，可自主使用 web_search、read、browser 等工具检索官方任务资料、标准或其他可信公开来源；对仍无法直接查证但可由系统工程分析确定的结构、行为、接口和追溯关系，形成明确标注的建模假设。抽取阶段不得修改工作台应用源码或工作区之外的持久文件。',
    '网页检索结果、读取结果、分析笔记、聊天中的 JSON 和 yield 参数都只是建模依据，不是候选工件。',
    `唯一候选工件必须落盘到这个绝对路径：${candidatePath}`,
    `形成第一版 confirmedData 后，必须调用 write 工具创建 "${candidatePath}"；write 的 path 必须精确使用该绝对路径，content 必须是完整 JSON 对象。后续局部修改调用 edit，需要整体重写时再次调用 write。不能只在回复、思考、工具参数或 yield 中给出候选。`,
    '候选抽取阶段已提供 verify_candidate。它的参数始终是空对象 {}，只读取上述固定候选文件；文件不存在时会要求调用 write。文件不完整时也应调用它获取反馈，按绝对路径诊断使用 edit/write 修正，再以相同的空对象 {} 调用。不要把 confirmedData 作为 verify_candidate 参数，也不要用 Python、正则或 eval 复刻引用校验。',
    '只有候选文件已通过 verify_candidate 且通过后未再修改，终止 yield 才会被接受。最终必须调用 yield，参数使用 result: { data: { suggestions: [...] } }，并省略 type。禁止使用 type: ["suggestions"] 等数组 section yield；数组 type 是增量、非终止提交，不会结束任务。confirmedData 不放入 yield，只以落盘文件为准。终止 yield 成功后 Sidecar 会立即中断当前 Agent 会话。',
    'eval 只用于短小的交互式检查；过长 eval 会被系统阻止。需要多步骤或可复用的 Python 等辅助脚本时，写入当前候选工作区的 scratch/scripts/（例如 scratch/scripts/inspect_candidate.py），再用 bash 短命令执行；中间数据、日志和笔记分别写入 scratch/data/、scratch/logs/、scratch/notes/。',
    '不得复制默认天问二号模板，也不得把外部资料或推断冒充用户原文事实。公开资料、建模假设和仍需用户确认的高影响不确定项必须分别记录在 suggestions 中。',
    '不得因为材料没有预先填写 projectId、packageName、稳定 ID、标题、追溯、活动、接口、约束、参数或绑定字段而直接失败：这些是建模 Agent 应生成、细化和关联的候选模型内容。projectId、packageName 与各元素稳定 ID 应根据项目语义确定性命名，不属于需要用户提供的领域事实。',
    '只有在材料无法识别任何建模对象或使命边界，并且检索与合理建模假设仍不足以形成可供用户确认的连贯候选时，才返回 error；不得仅以 schema 字段未在原文逐项出现为由拒绝建模。',
    '字段约束：mission 必须概括使命目标；requirements[].tracedTo 必须填写分系统名称；requirements[].parentId 与 subsystems[].parentId 仅在存在父元素时填写其稳定 ID，根元素填写 null；activities[].requirementIds、interfaces[].requirementIds 必须填写需求 ID；activities[].performedBy、interfaces[].sourceSubsystemId、interfaces[].targetSubsystemId、constraints[].relatedElementIds、parameters[].relatedElementIds、bindings[].relatedElementIds 必须填写分系统或元素 ID。',
    'confirmedData 必须形成完整且内部一致的候选模型，覆盖 requirements、subsystems、activities、interfaces、constraints、parameters、bindings；所有引用必须指向本次候选中的稳定 ID。',
    'suggestions 用于披露候选依据和待确认项。每项必须设置 category：external-source 表示公开资料，sourceUrls 至少列出一个本次会话通过网页搜索或读取工具实际获得的来源；engineering-assumption 表示系统工程建模假设；open-question 表示虽已给出当前候选但仍值得用户确认的高影响问题。每项还必须设置 confidence（high、medium 或 low），表达当前候选依据的置信度。affectedElements 使用用户可读名称列出受影响对象，不要求用户提供任何 ID；没有外部来源时 sourceUrls 返回空数组。',
    '',
    '材料：',
    sourceText,
  ].join('\n');
}

const DISCLOSURE_CATEGORIES = new Set(['external-source', 'engineering-assumption', 'open-question']);
const DISCLOSURE_CONFIDENCES = new Set(['high', 'medium', 'low']);
const RESEARCH_TOOL_NAMES = new Set(['web_search', 'read', 'browser']);

export function collectResearchedSourceUrls(events) {
  const sourceUrls = new Set();
  if (!Array.isArray(events)) return sourceUrls;

  for (const event of events) {
    const toolName = String(event?.toolName ?? '').split('.').at(-1);
    if (
      event?.type !== 'tool-call-end'
      || event.isError === true
      || !RESEARCH_TOOL_NAMES.has(toolName)
    ) {
      continue;
    }
    if (toolName === 'read') {
      const readUrl = normalizeHttpUrl(event?.payload?.args?.path);
      if (readUrl) sourceUrls.add(readUrl);
      continue;
    }
    if (toolName === 'browser') {
      const browserUrl = normalizeHttpUrl(event?.payload?.result?.url);
      if (browserUrl) sourceUrls.add(browserUrl);
      continue;
    }
    collectHttpUrls(event?.payload?.result, sourceUrls, new Set());
  }

  return sourceUrls;
}

function collectHttpUrls(value, sourceUrls, seen) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>，。；、）\])}]+/gu)) {
      const normalized = normalizeHttpUrl(match[0]);
      if (normalized) sourceUrls.add(normalized);
    }
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const nestedValue of Object.values(value)) {
    collectHttpUrls(nestedValue, sourceUrls, seen);
  }
}


function normalizeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeSourceUrlSet(values) {
  return new Set(Array.from(values ?? [], normalizeHttpUrl).filter(Boolean));
}

export function reconcileExtractionDisclosures(suggestions, researchedSourceUrls) {
  validateExtractionDisclosures(suggestions);
  const normalizedResearchedUrls = normalizeSourceUrlSet(researchedSourceUrls);

  return suggestions.map((suggestion) => {
    if (suggestion.category !== 'external-source') return suggestion;

    const verifiedSourceUrls = suggestion.sourceUrls
      .map(normalizeHttpUrl)
      .filter((url) => url && normalizedResearchedUrls.has(url));
    if (verifiedSourceUrls.length === suggestion.sourceUrls.length) {
      return { ...suggestion, sourceUrls: verifiedSourceUrls };
    }
    if (verifiedSourceUrls.length > 0) {
      return {
        ...suggestion,
        sourceUrls: verifiedSourceUrls,
        recommendation: `${suggestion.recommendation}；已移除未在本次会话网页工具结果中核实的链接。`,
      };
    }
    return {
      ...suggestion,
      category: 'engineering-assumption',
      confidence: 'low',
      sourceUrls: [],
      recommendation: `${suggestion.recommendation}；未在本次会话网页工具结果中核实来源，已降级为低置信度建模假设。`,
    };
  });
}


export function validateExtractionDisclosures(suggestions, researchedSourceUrls) {
  if (!Array.isArray(suggestions)) {
    throw new Error('Agent suggestions 必须是数组。');
  }
  const normalizedResearchedUrls = researchedSourceUrls === undefined
    ? null
    : normalizeSourceUrlSet(researchedSourceUrls);
  for (const [index, suggestion] of suggestions.entries()) {
    const path = `suggestions[${index}]`;
    if (!suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion)) {
      throw new Error(`${path} 必须是对象。`);
    }
    if (!DISCLOSURE_CONFIDENCES.has(suggestion.confidence)) {
      throw new Error(`${path}.confidence 必须为 high、medium 或 low。`);
    }
    if (!DISCLOSURE_CATEGORIES.has(suggestion.category)) {
      throw new Error(`${path}.category 不是受支持的候选依据类别。`);
    }
    if (
      !Array.isArray(suggestion.affectedElements)
      || suggestion.affectedElements.length === 0
      || suggestion.affectedElements.some((value) => typeof value !== 'string' || value.trim() === '')
    ) {
      throw new Error(`${path}.affectedElements 必须包含至少一个用户可读的候选对象名称。`);
    }
    if (!Array.isArray(suggestion.sourceUrls)) {
      throw new Error(`${path}.sourceUrls 必须是数组。`);
    }
    for (const [urlIndex, value] of suggestion.sourceUrls.entries()) {
      let sourceUrl;
      try {
        sourceUrl = new URL(value);
      } catch {
        throw new Error(`${path}.sourceUrls[${urlIndex}] 必须是有效 URL。`);
      }
      if (sourceUrl.protocol !== 'https:' && sourceUrl.protocol !== 'http:') {
        throw new Error(`${path}.sourceUrls[${urlIndex}] 必须使用 http 或 https。`);
      }
    }
    if (suggestion.category === 'external-source' && suggestion.sourceUrls.length === 0) {
      throw new Error(`${path} 标记为 external-source 时必须包含至少一个实际检索来源。`);
    }
    if (suggestion.category === 'external-source' && normalizedResearchedUrls) {
      const unverifiedUrl = suggestion.sourceUrls.find(
        (value) => !normalizedResearchedUrls.has(normalizeHttpUrl(value)),
      );
      if (unverifiedUrl) {
        throw new Error(`${path}.sourceUrls 包含未由本次会话成功网页搜索或读取结果返回的来源：${unverifiedUrl}`);
      }
    }
  }
}
