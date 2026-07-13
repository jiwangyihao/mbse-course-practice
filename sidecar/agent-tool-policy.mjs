export const MAX_INLINE_EVAL_CHARACTERS = 3_000;
export const MAX_INLINE_EVAL_LINES = 80;

export function createAgentToolPolicyExtension(pi) {
  pi.on('tool_call', async (event) => {
    if (event.toolName !== 'eval') return undefined;

    const code = typeof event.input?.code === 'string' ? event.input.code : '';
    const lineCount = code === '' ? 0 : code.split(/\r?\n/u).length;
    if (code.length <= MAX_INLINE_EVAL_CHARACTERS && lineCount <= MAX_INLINE_EVAL_LINES) {
      return undefined;
    }

    const language = typeof event.input?.language === 'string' ? event.input.language : 'script';
    return {
      block: true,
      reason: [
        `已阻止过长的 ${language} eval：${code.length} 个字符、${lineCount} 行；eval 只用于短小的交互式检查。`,
        '请用 write/edit 将脚本落盘到当前工作区 scratch/scripts/（例如 scratch/scripts/check_model.py），再用 bash 短命令执行脚本文件。',
        '若目的是检查候选 confirmedData，请调用 verify_candidate；若目的是检查 SysML 工作区，请直接调用 verify。不要用自写脚本复刻这些校验。',
      ].join('\n'),
    };
  });
}

export async function ensureRequiredToolsActive(session, requiredToolNames) {
  const required = [...new Set(requiredToolNames)];
  const allToolNames = session.getAllToolNames();
  const missingRegistered = required.filter((name) => !allToolNames.includes(name));
  if (missingRegistered.length > 0) {
    throw new Error(`Agent 会话缺少必需工具注册：${missingRegistered.join('、')}`);
  }

  let activeToolNames = session.getActiveToolNames();
  const inactiveRequired = required.filter((name) => !activeToolNames.includes(name));
  if (inactiveRequired.length > 0) {
    await session.setActiveToolsByName([...new Set([...activeToolNames, ...inactiveRequired])]);
    activeToolNames = session.getActiveToolNames();
  }

  const stillInactive = required.filter((name) => !activeToolNames.includes(name));
  if (stillInactive.length > 0) {
    throw new Error(`Agent 会话必需工具未激活：${stillInactive.join('、')}`);
  }
  return activeToolNames;
}
